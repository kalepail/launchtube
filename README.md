# Fee-Bump Service

## Base URL

[https://feebump.sdf-ecosystem.workers.dev](https://feebump.sdf-ecosystem.workers.dev/gen?ttl=10&credits=10000000&count=1)

## User Endpoints

### `GET` `/`

Get the remaining credits (stoops) available for your account

#### Headers

- `Authorization` `Bearer {jwt token}`

#### Return

`String` numeric value of the account’s remaining credits (stroops)

### `POST` `/`

Submit a transaction for fee-bumping

> [!IMPORTANT]  
> Credits are used when calling *this* endpoint successfully. **NOT** when submitting the fee-bumped transaction to the Stellar network.

#### Body

- `xdr`
    
    Transaction you want fee-bumped as an `XDR` encoded `String`
    
- `fee`
    
    Number of credits (stroops) you want to use per operation to submit the transaction
    

#### Headers

- `Content-Type` `x-www-form-urlencoded`
- `Authorization` `Bearer {jwt token}`

#### Return

`XDR` encoded `String` value of your original `xdr` now fee-bumped. Also there’s a `X-Credits-Remaining` header containing the number of remaining credits for this account

## Admin Endpoints

### `GET` `/gen`

Generate a list of new credit accounts

#### Query

- `ttl`
    
    The number of seconds these accounts should live for
    
- `credits`
    
    The number of credits these accounts can spend (in stroops)
    
- `count`
    
    The number of unique new accounts to generate (max of 100)
    

#### Headers

- `Authorization` `Bearer {auth token}`
    
    If you need an auth token let [tyler@stellar.org](mailto:tyler@stellar.org) know
    

#### Return

`JSON` array of jwt tokens which will be what you hand out like candy

### `DELETE` `/:sub`

Delete an existing account

#### Params

- `sub`
    
    The jwt `sub` claim of the account in question
    

#### Headers

- `Authorization` `Bearer {auth token}`
    
    If you need an auth token let [tyler@stellar.org](mailto:tyler@stellar.org) know

### `POST` `/sql`

Run a SQL query on the database

#### Body

- `query`
    
    SQL query you want to run. e.g. `SELECT * FROM Transactions LIMIT 100`
    
- `args`
    
    Positional arguments for the query. Include as strings in an array. e.g. `["arg1", "arg2"]`
    

#### Headers

- `Authorization` `Bearer {auth token}`
    
    If you need an auth token let [tyler@stellar.org](mailto:tyler@stellar.org) know

#### Return

JSON array of results from the query (if any)
e.g.
```json
[
    {
        "Sub": "712f3af6061d26ac4c573151e116547a3b58b364fcf5a6df8f1a5916d540cae3",
        "Tx": "40833f9c1b6e3187f7ff915a2bbad55e422650a283d3d13d941a5eaf81abaed7"
    },
    {
        "Sub": "712f3af6061d26ac4c573151e116547a3b58b364fcf5a6df8f1a5916d540cae3",
        "Tx": "f5b4d4638944ffab6ca693fe4036275c4822dd46e7e0f558a4e53a38f704fb45"
    },
    ...
]
```
Sub is the key JWT `sub` claim and Tx is the transaction hash