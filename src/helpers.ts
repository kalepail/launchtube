import { Account, authorizeEntry, Keypair, nativeToScVal, Operation, TransactionBuilder, xdr } from "@stellar/stellar-base"
import { networkPassphrase, simulateTransaction } from "./common"

const nativeContract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
// const nativeContract = 'CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT'
const testKeypair = Keypair.fromSecret('SDBU42TUE6HKIO3YBN3K66X5CC4EOUGUPAFUX7UFXXRMLPGECEUR2ZN4') // GASY26VMSOOCWFA2ZASHW2ZDIDZUQVXGVVKOGKSIDDTDWNSLIF6KKKCD
const testPubkey = testKeypair.publicKey()

export function wait(ms: number = 1000) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export function addUniqItemsToArray(arr: any[], ...items: any[]) {
    return [
        ...new Set([
            ...arr,
            ...items
        ])
    ]
}

export function removeValueFromArrayIfExists(arr: any[], value: any) {
    const index = arr.indexOf(value);

    if (index === -1)
        return false
    else {
        arr.splice(index, 1)
        return true
    }
};

export function getRandomNumber(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function getMockData(type: 'xdr' | 'op' | undefined = undefined) {
    const mockKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32)) // NOTE this isn't the actual zero address
    const mockPubkey = mockKeypair.publicKey()
    const mockSource = new Account(mockPubkey, '0')

    const transaction = new TransactionBuilder(mockSource, {
        fee: '0',
        networkPassphrase,
    })
        .addOperation(Operation.invokeContractFunction({
            contract: nativeContract,
            function: 'transfer',
            args: [
                nativeToScVal(testPubkey, { type: 'address' }),
                nativeToScVal(nativeContract, { type: 'address' }),
                nativeToScVal(100, { type: 'i128' })
                // nativeToScVal(-1, { type: 'i128' }) // to fail simulation
            ],
            auth: []
        }))
        .setTimeout(30)
        .build()

    const sim = await simulateTransaction(transaction.toXDR())

    const op = transaction.operations[0] as Operation.InvokeHostFunction

    for (const authXDR of sim.results[0].auth) {
        const authUnsigned = xdr.SorobanAuthorizationEntry.fromXDR(authXDR, 'base64')
        const authSigned = await authorizeEntry(authUnsigned, testKeypair, sim.latestLedger + 60, networkPassphrase)

        op.auth!.push(authSigned) // comment this out to fail submission
    }

    const fee = getRandomNumber(10_000, 100_000).toString()

    return type === 'op'
        ? {
            func: op.func.toXDR('base64'),
            auth: JSON.stringify(op.auth?.map((auth) => auth.toXDR('base64'))),
            fee
        }
        : {
            xdr: transaction.toXDR(),
            fee
        }
}