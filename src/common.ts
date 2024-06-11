import { Networks } from "@stellar/stellar-base";
import { fetcher } from "itty-fetcher";

export const horizon = fetcher({ 
    // base: 'https://horizon-testnet.stellar.org' 
    base: 'https://horizon-futurenet.stellar.org'
})
export const rpc = fetcher({
    // base: 'https://soroban-testnet.stellar.org'
    base: 'https://rpc-futurenet.stellar.org'
})
export const networkPassphrase = Networks.FUTURENET