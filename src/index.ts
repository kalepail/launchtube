import { xdr, BASE_FEE, Keypair, Operation, StrKey, TransactionBuilder, Transaction, Address } from "@stellar/stellar-base";
import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, RequestLike, cors, error, json, text, withParams } from 'itty-router'
import { verify, decode, sign } from '@tsndr/cloudflare-worker-jwt'
import { object, preprocess, number, string, array, ZodIssueCode } from "zod";
import { getAccount, networkPassphrase, sendTransaction, simulateTransaction } from "./common";
import { getMockData } from "./helpers";

const MAX_U32 = 2 ** 32 - 1
const SEQUENCER_ID_NAME = 'Test Launchtube ; June 2024'
const EAGER_CREDITS = 100_000

const { preflight, corsify } = cors()
const router = IttyRouter()

/* TODO
	- Likely need some rate limiting around here
		Throttle on dupe params
		Throttle on sequence creation
		Eager credit spending may be a sufficient deterrent
	- Support generic transaction fee bumping?
		I think folks will want this, otherwise they'll need to maintain both Soroban submission flows and Classic submission flows
			No XLM needed for Soroban
			XLM needed for Stellar
			Bit of an oof
		At the very least we should support all the Soroban ops incl. `Operation.ExtendFootprintTTL` and `Operation.RestoreFootprint`
*/

router
	.options('*', preflight)
	.all('*', withParams)
	.post('/', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await verify(token, env.JWT_SECRET))
			return error(401, 'Unauthorized')

		const { payload } = decode(token)

		if (!payload?.sub)
			return error(401, 'Invalid')

		let res: any
		let credits: number
		let sequencerId: DurableObjectId
		let sequencerStub: DurableObjectStub<SequencerDurableObject> | undefined
		let sequenceSecret: string | undefined

		try {
			const formData = await request.formData()
			const mock = formData.get('mock')
			const isMock = ['true', 'xdr', 'op'].includes(mock)
			const debug = formData.get('debug') === 'true'

			const schema = object({
				xdr: string().optional(),
				func: string().optional(),
				auth: preprocess(
					(val) => val ? JSON.parse(val as string) : undefined,
					array(string()).optional()
				),
				fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(MAX_U32)),
			}).superRefine((input, ctx) => {
				if (!input.xdr && !input.func && !input.auth)
					ctx.addIssue({
						code: ZodIssueCode.custom,
						message: 'Must pass either `xdr` or `func` and `auth`'
					})
				else if (input.xdr && (input.func || input.auth))
					ctx.addIssue({
						code: ZodIssueCode.custom,
						message: '`func` and `auth` must be omitted when passing `xdr`'
					})
				else if (!input.xdr && !(input.func && input.auth))
					ctx.addIssue({
						code: ZodIssueCode.custom,
						message: '`func` and `auth` are both required when omitting `xdr`'
					})
			})

			const {
				xdr: x,
				func: f,
				auth: a,
				fee,
			} = schema.parse(
				isMock && env.ENV === 'development'
					? await getMockData(mock) // Only ever mock in development
					: Object.fromEntries(formData)
			)

			if (debug)
				return json({ xdr: x, func: f, auth: a, fee })

			const creditsId = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub)
			const creditsStub = env.CREDITS_DURABLE_OBJECT.get(creditsId) as DurableObjectStub<CreditsDurableObject>;

			// Spend some initial credits before doing any work as a spam prevention measure. These will be refunded if the transaction succeeds
			// TODO at some point we should decide if the failure was user error or system error and refund the credits in case of system error
			credits = await creditsStub.spendBefore(EAGER_CREDITS)

			sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
			sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;
			sequenceSecret = await sequencerStub.getSequence()

			const sequenceKeypair = Keypair.fromSecret(sequenceSecret)
			const sequencePubkey = sequenceKeypair.publicKey()
			const sequenceSource = await getAccount(sequencePubkey)

			let func: xdr.HostFunction
			let auth: xdr.SorobanAuthorizationEntry[] | undefined

			// Passing `xdr`
			if (x) {
				const t = new Transaction(x, networkPassphrase)

				if (t.operations.length !== 1)
					throw 'Must include only one Soroban operation'

				for (const op of t.operations) {
					if (op.type !== 'invokeHostFunction')
						throw 'Must include only one operation of type `invokeHostFunction`'
				}

				const op = t.operations[0] as Operation.InvokeHostFunction

				func = op.func
				auth = op.auth
			}

			// Passing `func` and `auth`
			else if (f && a) {
				func = xdr.HostFunction.fromXDR(f, 'base64')
				auth = a?.map((auth) => xdr.SorobanAuthorizationEntry.fromXDR(auth, 'base64'))
			}

			else
				throw 'Invalid request'

			if (func.switch().name !== 'hostFunctionTypeInvokeContract')
				throw 'Operation func must be of type `hostFunctionTypeInvokeContract`'

			/* TODO !!!
				- Should we check that we have the right auth? Might be a fools errand if simulation can't catch it
					I think we can review the included `auth` array and ensure there are no empty credentials
			*/
			// Do a full audit of the auth entries
			for (const a of auth || []) {
				switch (a.credentials().switch().name) {
					case 'sorobanCredentialsSourceAccount':
						throw '`sorobanCredentialsSourceAccount` credentials are not supported'
					case 'sorobanCredentialsAddress':
						// Check to ensure the auth isn't using any system addresses
						if (a.credentials().address().address().switch().name === 'scAddressTypeAccount') {
							const pk = a.credentials().address().address().accountId()

							if (
								pk.switch().name === 'publicKeyTypeEd25519'
								&& Address.account(pk.ed25519()).toString() === sequencePubkey
							) throw '`scAddressTypeAccount` credentials are invalid'
						}
						break;
					default:
						throw 'Invalid credentials'
				}
			}

			const invokeContract = func.invokeContract()
			const contract = StrKey.encodeContract(invokeContract.contractAddress().contractId())

			let transaction = new TransactionBuilder(sequenceSource, {
				fee: '0',
				networkPassphrase
			})
				.addOperation(Operation.invokeContractFunction({
					contract,
					function: invokeContract.functionName().toString(),
					args: invokeContract.args(),
					auth
				}))
				.setTimeout(5 * 60)
				.build()

			transaction.sign(sequenceKeypair)

			const sim = await simulateTransaction(transaction.toXDR())
			const sorobanData = xdr.SorobanTransactionData.fromXDR(sim.transactionData, 'base64')
			const resourceFee = sorobanData.resourceFee().toBigInt()
			/* NOTE 
				Divided by 2 as a workaround to my workaround solution where TransactionBuilder.buildFeeBumpTransaction tries to be smart about the op base fee
				Note the fee is also part of the divide by 2 which means this will be the max in addition to the resource fee you'll pay for both the inner fee and the fee-bump combined
				https://github.com/stellar/js-stellar-base/issues/749
				https://github.com/stellar/js-stellar-base/compare/master...inner-fee-fix
				https://discord.com/channels/897514728459468821/1245935726424752220
			*/
			const feeBumpFee = (BigInt(fee) + resourceFee) / 2n

			transaction = TransactionBuilder
				.cloneFrom(transaction, {
					fee: resourceFee.toString(), // NOTE inner tx fee cannot be less than the resource fee or the tx will be invalid
					sorobanData
				})
				.build()

			transaction.sign(sequenceKeypair)

			const fundKeypair = Keypair.fromSecret(env.FUND_SK)
			const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
				fundKeypair,
				feeBumpFee.toString(),
				transaction,
				networkPassphrase
			)

			feeBumpTransaction.sign(fundKeypair)

			const bidCredits = Number(feeBumpTransaction.fee)

			// Refund eager credits and spend the tx bid credits
			credits = await creditsStub.spendBefore(bidCredits, EAGER_CREDITS)

			res = await sendTransaction(feeBumpTransaction.toXDR())

			const feeCredits = xdr.TransactionResult.fromXDR(res.resultXdr, 'base64').feeCharged().toBigInt()

			// Refund the bid credits and spend the actual fee credits
			credits = await creditsStub.spendAfter(
				Number(feeCredits),
				feeBumpTransaction.hash().toString('hex'),
				bidCredits
			)
		} finally {
			// if this fails we'd lose the sequence keypair. Fine because sequences are derived and thus re-discoverable
			if (sequencerStub && sequenceSecret)
				await sequencerStub.returnSequence(sequenceSecret)
		}

		return json(res, {
			headers: {
				'X-Credits-Remaining': credits,
			}
		})
	})
	.get('/seq', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		if (env.ENV !== 'development') { // TODO DRY out Authorization checks
			const token = request.headers.get('Authorization').split(' ')[1]

			if (!await env.SUDOS.get(token))
				return error(401, 'Unauthorized')
		}

		const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
		const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;

		return json(await sequencerStub.getData())
	})
	.get('/gen', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		if (env.ENV !== 'development') {
			const token = request.headers.get('Authorization').split(' ')[1]

			if (!await env.SUDOS.get(token))
				return error(401, 'Unauthorized')
		}

		const body = object({
			ttl: preprocess(Number, number()),
			credits: preprocess(Number, number()),
			count: preprocess(Number, number().gte(1).lte(100)),
		});

		let { ttl, credits, count } = body.parse(request.query)

		const tokens = []

		while (count--) {
			const id = env.CREDITS_DURABLE_OBJECT.newUniqueId();
			const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;
			const token = await sign({
				sub: id.toString(),
				exp: Math.floor((Date.now() + ttl * 1000) / 1000) // ~6 months, 26 weeks 
			}, env.JWT_SECRET)

			await stub.init(ttl, credits);

			tokens.push(token)
		}

		return json(tokens)
	})
	.get('/', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await verify(token, env.JWT_SECRET))
			return error(401, 'Unauthorized')

		const { payload } = decode(token)

		if (!payload?.sub)
			return error(401, 'Invalid')

		const id = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub)
		const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

		const info = await stub.info()

		return text(info)
	})
	.delete('/:sub', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await env.SUDOS.get(token))
			return error(401, 'Unauthorized')

		const id = env.CREDITS_DURABLE_OBJECT.idFromString(request.params.sub)
		const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

		await stub.delete()

		return text('OK')
	})
	.post('/sql', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await env.SUDOS.get(token))
			return error(401, 'Unauthorized')

		const body = object({
			query: string(),
			args: preprocess(
				(val) => val ? JSON.parse(val as string) : undefined,
				array(string()).optional()
			)
		});

		let { query, args } = body.parse(Object.fromEntries(await request.formData()))

		let results = []

		if (args) {
			const { results: r } = await env.DB.prepare(query)
				.bind(...args)
				.all();

			results = r
		} else {
			const { results: r } = await env.DB.prepare(query)
				.all();

			results = r
		}

		return json(results)
	})
	.all('*', () => error(404))

const handler = {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(request, env, ctx)
			.catch((err) => {
				console.error(err);
				return error(
					typeof err?.status === 'number' ? err.status : 400,
					err instanceof Error ? err?.message : err
				)
			})
			.then((r) => corsify(r, request))
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	handler as default
}