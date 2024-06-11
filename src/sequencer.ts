import { Account, Keypair, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-base";
import { DurableObject } from "cloudflare:workers";
import { horizon, networkPassphrase } from "./common";

export class SequencerDurableObject extends DurableObject<Env> {
    private ready: boolean = true
    private queue: Keypair[] = []

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    public async getData() {
        return this.ctx.storage.list()
    }
    public async getSequence() {
        const items = await this.ctx.storage.list<boolean>({ prefix: 'pool:', limit: 1 })

        if (!items.size) {
            const sequenceKeypair = Keypair.random()
            await this.queueSequence(sequenceKeypair)
            return sequenceKeypair.secret()
        } 
        
        else {
            const [[key]] = items.entries()
            const sequenceSecret = key.split(':')[1]

            this.ctx.storage.delete(`pool:${sequenceSecret}`)
            this.ctx.storage.put(`field:${sequenceSecret}`, true)

            return sequenceSecret
        }
    }
    public async returnSequence(sequenceSecret: string) {
        this.ctx.storage.delete(`field:${sequenceSecret}`)
        this.ctx.storage.put(`pool:${sequenceSecret}`, true)
    }

    private async queueSequence(sequenceKeypair: Keypair, add: boolean = true) {
        if (await this.ctx.storage.get<string>(`pool:${sequenceKeypair.secret()}`))
            return

        if (add)
            this.queue = [
                ...new Set([
                    ...this.queue,
                    sequenceKeypair
                ])
            ]

        if (this.ready)
            await this.createSequences(this.queue.splice(0, 100))
        else {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            await this.queueSequence(sequenceKeypair, false)
        }
    }
    private async createSequences(queue: Keypair[]) {
        try {
            if (!queue.length)
                return

            this.ready = false

            const sourceKeypair = Keypair.fromSecret(this.env.FEEBUMP_SK)
            const sourcePubkey = sourceKeypair.publicKey()

            const source = await horizon.get(`/accounts/${sourcePubkey}`).then((account: any) => new Account(account.id, account.sequence))

            let transaction: TransactionBuilder | Transaction = new TransactionBuilder(source, {
                fee: (10_000).toString(),
                networkPassphrase,
            })

            for (const sequence of queue) {
                transaction
                    .addOperation(Operation.createAccount({
                        destination: sequence.publicKey(),
                        startingBalance: '1'
                    }))
            }

            transaction = transaction
                .setTimeout(5 * 60)
                .build()

            transaction.sign(sourceKeypair)

            const data = new FormData()

            data.set('tx', transaction.toXDR())

            await horizon.post('/transactions', data)

            for (const sequence of queue) {
                this.ctx.storage.put(`pool:${sequence.secret()}`, true)
            }
        } finally {
            this.ready = true
        }
    }
}