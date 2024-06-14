# Launchtube Service

## Base URL

[https://launchtube.sdf-ecosystem.workers.dev](https://launchtube.sdf-ecosystem.workers.dev/gen?ttl=10&credits=10000000&count=1)

## Public Endpoints

### `GET` `/`

Get the remaining credits (stoops) available for your account

#### Headers

- `Authorization` `Bearer {jwt token}`

#### Return

`String` numeric value of the account’s remaining credits (stroops)

### `POST` `/`

Submit a transaction

> [!IMPORTANT]  
> Credits are spent with progressive levels of granularity as the transaction moves through the backend
> Initially upon submission 100_000 credits are spent
> Assuming your tx simulates successfully, those 100_000 credits are refunded and the tx bid fee is spent
> If your tx submission is successful the bid is refunded and the final tx fee is spent 

#### Body

- `xdr`
    
    Transaction you want submitted as an `XDR` encoded `String`
    
- `fee`
    
    Number of credits (stroops) you want to use per operation to submit the transaction
    

#### Headers

- `Content-Type` `x-www-form-urlencoded`
- `Authorization` `Bearer {jwt token}`

#### Return

The response of the transaction submission assuming it was successful. Otherwise the error will be returned

<details closed>
<summary><h2>Private Endpoints</h2></summary>
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
</details>
