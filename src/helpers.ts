import { Account, authorizeEntry, Keypair, nativeToScVal, Operation, TransactionBuilder, xdr } from "@stellar/stellar-base"
import { networkPassphrase, rpc } from "./common"

const testKeypair = Keypair.fromSecret('SDBU42TUE6HKIO3YBN3K66X5CC4EOUGUPAFUX7UFXXRMLPGECEUR2ZN4') // GASY26VMSOOCWFA2ZASHW2ZDIDZUQVXGVVKOGKSIDDTDWNSLIF6KKKCD
const testPubkey = testKeypair.publicKey()

export async function getMockOp() {
    const mockKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32))
    const mockPubkey = mockKeypair.publicKey()
    const mockSource = new Account(mockPubkey, '0')

    const transaction = new TransactionBuilder(mockSource, {
        fee: '0',
        networkPassphrase,
    })
        .addOperation(Operation.invokeContractFunction({
            // contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
            contract: 'CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT',
            function: 'transfer',
            args: [
                nativeToScVal(testPubkey, { type: 'address' }),
                nativeToScVal('CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT', { type: 'address' }),
                nativeToScVal(100, { type: 'i128' })
            ],
            auth: []
        }))
        .setTimeout(0)
        .build()

    const sim = await rpc.post('/', {
        jsonrpc: "2.0",
        id: 8891,
        method: "simulateTransaction",
        params: {
            transaction: transaction.toXDR()
        }
    }).then((res: any) => {
        if (res.result.error)
            throw res.result

        return res.result
    })

    const op = transaction.operations[0] as Operation.InvokeHostFunction

    for (const authXDR of sim.results[0].auth) {
        const authUnsigned = xdr.SorobanAuthorizationEntry.fromXDR(authXDR, 'base64')
        const authSigned = await authorizeEntry(authUnsigned, testKeypair, sim.latestLedger + 60)

        op.auth!.push(authSigned)
    }

    return {
        func: op.func.toXDR('base64'),
        auth: JSON.stringify(op.auth?.map((auth) => auth.toXDR('base64'))),
        fee: 10_000
    }
}