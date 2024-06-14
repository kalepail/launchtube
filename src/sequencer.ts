import { Keypair, Operation, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-base";
import { DurableObject } from "cloudflare:workers";
import { getAccount, sendTransaction } from "./common";
import { vars, addUniqItemsToArray, getRandomNumber, removeValueFromArrayIfExists, wait } from "./helpers";

export class SequencerDurableObject extends DurableObject<Env> {
    private ready: boolean = true
    private queue: string[] = []
    private no: string[] = []

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    public async getData() {
        const pool = await this.ctx.storage.list({ prefix: 'pool:' })
        const field = await this.ctx.storage.list({ prefix: 'field:' })
        const index = await this.ctx.storage.get<number>('index') || 0

        return {
            index,
            no: this.no,
            poolCount: pool.size,
            fieldCount: field.size,
            pool: [...pool.entries()],
            field: [...field.entries()]
        }
    }
    public async getSequence(): Promise<string> {
        const items = await this.ctx.storage.list<boolean>({ prefix: 'pool:', limit: 1 })

        if (items.size) {
            const [[key]] = items.entries()
            const sequenceSecret = key.split(':')[1]

            this.ctx.storage.delete(`pool:${sequenceSecret}`)
            this.ctx.storage.put(`field:${sequenceSecret}`, true)

            return sequenceSecret
        } else {
            const sequenceSecret = await this.queueSequence()
            const poolSecret = await this.pollSequence(sequenceSecret)

            if (poolSecret)
                this.ctx.storage.delete(`pool:${poolSecret}`)

            this.ctx.storage.put(`field:${poolSecret || sequenceSecret}`, true)

            return poolSecret || sequenceSecret
        }
    }
    public async deleteSequence(sequence: string) {
        this.ctx.storage.delete(`field:${sequence}`)
        this.ctx.storage.delete(`pool:${sequence}`)
    }
    public async returnSequence(sequence: string) {
        this.ctx.storage.delete(`field:${sequence}`)
        this.ctx.storage.put(`pool:${sequence}`, true)
    }

    // e.g. scenario
    // 100 requests for new sequences comes in
    // All are queued up and begin to wait
    // Once the fund account is ready the first 25 are taken from the queue
    // A transaction is created to create the accounts and submitted
    // In case of success or failure we need to communicate that back to the 25 pending requests
    // Repeat taking the next batch of queued sequences 

    private async queueSequence() {
        /* TODO
            - Don't love this. 
                Ideally we switch to a queue system that can handle this in a more elegant manner
                On the plus side needing to spin up new sequence accounts shouldn't be terribly common
            - This might have broken something as it seems it's also leaving orphaned no's
                It's possible this was due to trying to create already created accounts though
        */
        if (this.queue.length >= 25)
            throw 'Too many sequences queued. Please try again later'

        const index = await this.ctx.storage.get<number>('index') || 0
        const indexBuffer = Buffer.alloc(4);

        indexBuffer.writeUInt32BE(index);

        // Seed new sequences in a reproducible way so we can always recreate them to recoup "lost" accounts
        const sequenceBuffer = Buffer.concat([
            StrKey.decodeEd25519SecretSeed(this.env.FUND_SK),
            indexBuffer
        ])
        const sequenceSeed = await crypto.subtle.digest({ name: 'SHA-256' }, sequenceBuffer);
        const sequenceKeypair = Keypair.fromRawEd25519Seed(Buffer.from(sequenceSeed))
        const sequenceSecret = sequenceKeypair.secret()

        this.queue = addUniqItemsToArray(this.queue, sequenceSecret)

        await this.ctx.storage.put('index', index + 1)

        return sequenceKeypair.secret()
    }
    private async pollSequence(sequenceSecret: string, interval = 0): Promise<string | null> {
        const poolSecret = await this.lookupPoolSequence(sequenceSecret)

        if (removeValueFromArrayIfExists(this.no, sequenceSecret)) {
            // We failed, but before we despair, let's see if there are any pool sequences available
            if (poolSecret)
                return poolSecret
            else
                throw 'Sequencer transaction failed. Please try again'
        }

        if (poolSecret)
            return poolSecret

        if (interval >= 30 && this.ready) // ensure transaction isn't in flight before timing out
            throw 'Sequencer transaction timed out. Please try again'

        if (this.ready)
            this.createSequences(this.queue.splice(0, 25)) // No need to block the request waiting for this

        interval++
        await wait()
        return this.pollSequence(sequenceSecret, interval)
    }
    private async lookupPoolSequence(sequenceSecret: string) {
        // Lookup our own key first
        if (await this.ctx.storage.get<boolean>(`pool:${sequenceSecret}`))
            return sequenceSecret

        const items = await this.ctx.storage.list<boolean>({ prefix: 'pool:', limit: 1 })

        // It's possible during the retry loop a pool sequence comes available at which point we should pull out our pending sequence and use the pool sequence
        if (items.size) {
            removeValueFromArrayIfExists(this.queue, sequenceSecret)

            const [[key]] = items.entries()
            return key.split(':')[1]
        }
    }
    private async createSequences(queue: string[]) {
        try {
            this.ready = false

            const { networkPassphrase } = vars(this.env)

            const fundKeypair = Keypair.fromSecret(this.env.FUND_SK)
            const fundPubkey = fundKeypair.publicKey()
            const fundSource = await getAccount(this.env, fundPubkey)

            let transaction: TransactionBuilder | Transaction = new TransactionBuilder(fundSource, {
                fee: getRandomNumber(10_000, 100_000).toString(),
                networkPassphrase,
            })

            for (const sequence of queue) {
                transaction
                    .addOperation(Operation.createAccount({
                        destination: Keypair.fromSecret(sequence).publicKey(),
                        startingBalance: '1'
                    }))
            }

            transaction = transaction
                .setTimeout(60)
                .build()

            transaction.sign(fundKeypair)

            await sendTransaction(this.env, transaction.toXDR())

            // If we fail here we'll lose the sequence keypairs. Keypairs should be derived so they can always be recreated
            for (const sequenceSecret of queue) {
                this.ctx.storage.put(`pool:${sequenceSecret}`, true)
            }
        } catch (err) {
            this.no = addUniqItemsToArray(this.no, ...queue.map((sequence) => Keypair.fromSecret(sequence).secret()))
            console.log(err);
            await wait(5000);
            // No need to throw here as we'll catch tx errors elsewhere in the lookupSequence
        } finally {
            this.ready = true
        }
    }
}