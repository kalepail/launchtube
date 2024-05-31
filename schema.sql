DROP TABLE IF EXISTS Transactions;
CREATE TABLE IF NOT EXISTS Transactions (
    Sub TEXT, 
    Tx TEXT,
    UNIQUE (Sub, Tx)
);