import { Keypair, Networks, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
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

		const transaction = new Transaction(xdr, Networks.PUBLIC)

		const feebump = TransactionBuilder.buildFeeBumpTransaction(keypair, fee.toString(), transaction, Networks.PUBLIC);

		feebump.sign(keypair);

		const existing_credits = Number(await this.ctx.storage.get('credits'))

		if (
			!existing_credits
			|| Number.isNaN(existing_credits)
			|| existing_credits <= 0
		) throw new Error('No credits left')

		const now_credits = existing_credits - (fee * transaction.operations.length);

		await this.ctx.storage.put('credits', now_credits);

		return {
			tx: feebump.toXDR(),
			credits: now_credits
		}
	}

	async alarm() {
		await this.delete();
	}
}