import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-base";
import { DurableObject } from "cloudflare:workers";
import { networkPassphrase } from "./common";

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
		const transaction = new Transaction(xdr, networkPassphrase)

		// use the soroban resource fee if it's available
		const resourceFee = transaction.toEnvelope().v1().tx().ext().sorobanData()?.resourceFee().toString()
		// NOTE: divided by 2 as a workaround to my workaround solution where TransactionBuilder.buildFeeBumpTransaction tries to be smart about the op base fee
		// https://github.com/stellar/js-stellar-base/issues/749
		// https://github.com/stellar/js-stellar-base/compare/master...inner-fee-fix
		// https://discord.com/channels/897514728459468821/1245935726424752220
		const jank_fee = resourceFee 
			? Math.ceil((Number(resourceFee) + fee) / 2) // If Soroban tx handle the fee as a total inclusion fee combining the outer and inner base fee
			: Math.ceil(fee / (transaction.operations.length + 1)) // Otherwise treat the fee as a total tx fee divided into per operation fees
		const feebump = TransactionBuilder.buildFeeBumpTransaction(keypair, jank_fee.toString(), transaction, networkPassphrase);

		feebump.sign(keypair);

		const existing_credits = Number(await this.ctx.storage.get('credits'))

		if (
			!existing_credits
			|| Number.isNaN(existing_credits)
			|| existing_credits <= 0
		) throw 'No credits left'

		const now_credits = existing_credits - Number(feebump.fee);

		if (now_credits < 0)
			throw 'Not enough credits'

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