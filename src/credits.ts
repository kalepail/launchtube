import { DurableObject } from "cloudflare:workers";

export class CreditsDurableObject extends DurableObject<Env> {
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

	async spend(credits: number, tx: string) {
		const existing_credits = Number(await this.ctx.storage.get('credits'))

		if (
			!existing_credits
			|| Number.isNaN(existing_credits)
			|| existing_credits <= 0
		) throw 'No credits left'

		const now_credits = existing_credits - credits;

		if (now_credits < 0)
			throw 'Not enough credits'

		await this.ctx.storage.put('credits', now_credits);

		// Since metrics aren't critical punt them into the `ctx.waitUntil` 
		const metric = this.env.DB.prepare(`
			INSERT OR IGNORE INTO Transactions (Sub, Tx) 
			VALUES (?1, ?2)
		`)
			.bind(
				this.ctx.id.toString(),
				tx
			)
			.run()

		this.ctx.waitUntil(metric)

		return now_credits
	}

	async alarm() {
		await this.delete();
	}
}