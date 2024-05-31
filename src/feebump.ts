import { Keypair, Networks, Transaction, TransactionBuilder } from "@stellar/stellar-base";
import { DurableObject } from "cloudflare:workers";

export class FeeBumpDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async init(ttl: number, credits: number) {
		await this.ctx.storage.put('credits', credits);
		await this.ctx.storage.setAlarm(Date.now() + ttl * 1000);
	}

	async info() {
		return this.ctx.storage.get('credits')
	}

	async delete() {
		await this.ctx.storage.deleteAll();
	}

	async bump(xdr: string, fee: number) {
		const keypair = Keypair.fromSecret(this.env.FEEBUMP_SK);
		const transaction = new Transaction(xdr, Networks.TESTNET)

		// NOTE: divided by 2 as a workaround to my workaround solution where TransactionBuilder.buildFeeBumpTransaction tries to be smart about the op base fee
		// https://github.com/stellar/js-stellar-base/issues/749
		// https://github.com/stellar/js-stellar-base/compare/master...inner-fee-fix
		// https://discord.com/channels/897514728459468821/1245935726424752220
		const jank_fee = (Number(transaction.fee) + fee) / 2
		const feebump = TransactionBuilder.buildFeeBumpTransaction(keypair, jank_fee.toString(), transaction, Networks.TESTNET);

		feebump.sign(keypair);

		const existing_credits = Number(await this.ctx.storage.get('credits'))

		if (
			!existing_credits
			|| Number.isNaN(existing_credits)
			|| existing_credits <= 0
		) throw new Error('No credits left')

		const now_credits = existing_credits - (fee * transaction.operations.length);

		if (now_credits < 0)
			throw new Error('Not enough credits')

		await this.ctx.storage.put('credits', now_credits);

		await this.env.DB.prepare(`
			INSERT OR IGNORE INTO Transactions (Sub, Tx) 
			VALUES (?1, ?2)
		`)
			.bind(
				this.ctx.id.toString(),
				feebump.hash().toString('hex')
			)
			.run()

		return {
			tx: feebump.toXDR(),
			credits: now_credits
		}
	}

	async alarm() {
		await this.delete();
	}
}