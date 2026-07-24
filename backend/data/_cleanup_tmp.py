import sqlite3
p = r'd:\智能记账\backend\data\app.db'
c = sqlite3.connect(p)
cur = c.cursor()
for acc in ['667788', '112233']:
    cur.execute("UPDATE users SET is_deleted=1, deleted_at=datetime('now') WHERE account_no=?", (acc,))
    print(f"{acc} rows affected: {cur.rowcount}")
c.commit()
cur.execute('SELECT account_no,is_deleted FROM users WHERE account_no IN (?,?)', ('667788','112233'))
for r in cur.fetchall(): print(r)
c.close()
