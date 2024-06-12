import { xdr, Networks, Keypair, Account } from "@stellar/stellar-base";
import { fetcher } from "itty-fetcher";
import { wait } from "./helpers";

export const rpc = fetcher({
    base: 'https://soroban-testnet.stellar.org'
    // base: 'https://rpc-futurenet.stellar.org'
})
export const networkPassphrase = Networks.TESTNET
// export const networkPassphrase = Networks.FUTURENET

/* TODO
    - Add in all the types from stellar-sdk
        Doesn't look like they're exported so we'll need to manually copy that file over
*/

export function getAccount(publicKey: string) {
    return rpc.post('/', {
        jsonrpc: "2.0",
        id: 8891,
        method: "getLedgerEntries",
        params: {
            keys: [
                xdr.LedgerKey.account(
                    new xdr.LedgerKeyAccount({
                        accountId: Keypair.fromPublicKey(publicKey).xdrPublicKey()
                    })
                ).toXDR('base64')
            ]
        }
    })
        .then((res: any) => {
            if (res.result.error)
                throw res.result

            if (!res.result.entries.length)
                throw `Account ${publicKey} not found`

            const account = xdr.LedgerEntryData.fromXDR(res.result.entries[0].xdr, 'base64').account()

            return new Account(publicKey, account.seqNum().toString()) 
        })
}

export function simulateTransaction(xdr: string) {
    return rpc.post('/', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'simulateTransaction',
        params: {
            transaction: xdr
        }
    }).then((res: any) => {
        if (res.result.error) // TODO handle state archival 
            throw res.result

        return res.result
    })
}

export function sendTransaction(xdr: string) {
    return rpc.post('/', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'sendTransaction',
        params: {
            transaction: xdr
        }
    }).then((res: any) => {

        // 'PENDING'
        // 'DUPLICATE'
        // 'TRY_AGAIN_LATER'
        // 'ERROR'
        if (res.result.status === 'PENDING')
            return pollTransaction(res.result)
        else
            throw {
                xdr,
                ...res.result
            }
    })
}

export function getTransaction(hash: string) {
    return rpc.post('/', {
        jsonrpc: '2.0',
        id: 8891,
        method: 'getTransaction',
        params: {
            hash: hash
        }
    }).then((res: any) => {

        // 'SUCCESS'
        // 'NOT_FOUND'
        // 'FAILED'
        if (res.result.status === 'FAILED')
            throw res.result

        return res.result
    })
}

async function pollTransaction(sendResult: any, interval = 0) {
    const getResult = await getTransaction(sendResult.hash)

    console.log(interval, getResult.status);

    if (getResult.status === 'SUCCESS') {
        return {
            hash: sendResult.hash,
            ...getResult,
        }
    } else if (interval >= 30)
        throw getResult

    interval++
    await wait()
    return pollTransaction(sendResult, interval)
}