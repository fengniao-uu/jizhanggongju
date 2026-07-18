from typing import Optional, List, Dict, Any
from . import DatabaseAdapter


D1_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_no CHAR(6) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type CHAR(4) NOT NULL CHECK(type IN ('收入','支出')),
    name VARCHAR(20) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    disabled BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(user_id, type, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_user_type ON categories(user_id, type);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type CHAR(4) NOT NULL CHECK(type IN ('收入','支出')),
    category VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK(amount > 0),
    description VARCHAR(200) NOT NULL DEFAULT '',
    room_no VARCHAR(20) NOT NULL DEFAULT '',
    trans_date DATE NOT NULL,
    tag VARCHAR(50) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, trans_date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user_cat ON transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_tx_user_room ON transactions(user_id, room_no);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_no VARCHAR(20) NOT NULL,
    rent_amount DECIMAL(12,2) NOT NULL CHECK(rent_amount >= 0),
    due_date DATE NOT NULL,
    lease_end_date DATE,
    status VARCHAR(10) NOT NULL DEFAULT '未完成' CHECK(status IN ('未完成','已完成','已确认')),
    remark VARCHAR(200) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rem_user_due ON reminders(user_id, due_date);

CREATE TABLE IF NOT EXISTS session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    jti CHAR(36) NOT NULL UNIQUE,
    revoked BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON session_logs(user_id);

CREATE TABLE IF NOT EXISTS captcha_store (
    id CHAR(32) PRIMARY KEY,
    code_hash CHAR(64) NOT NULL,
    salt CHAR(16) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_captcha_exp ON captcha_store(expires_at);

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(80) NOT NULL,
    content TEXT NOT NULL,
    banner_level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK(banner_level IN ('info','success','warning','danger')),
    priority INTEGER NOT NULL DEFAULT 0,
    is_pinned BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    effective_at TIMESTAMP,
    expire_at TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ann_active ON announcements(is_active, is_deleted);
"""

_d1_db = None


def set_d1_db(db):
    global _d1_db
    _d1_db = db


def get_d1_db():
    global _d1_db
    if _d1_db is None:
        raise RuntimeError("D1 database not initialized. Call set_d1_db() first.")
    return _d1_db


class D1Adapter(DatabaseAdapter):
    def __init__(self):
        self._db = None
        self._init_schema_done = False

    def _get_db(self):
        if self._db is None:
            self._db = get_d1_db()
            if not self._init_schema_done:
                self.init_schema()
        return self._db

    def _execute(self, sql, params=None):
        db = self._get_db()
        args = params or []
        try:
            stmt = db.prepare(sql)
            if args:
                stmt = stmt.bind(*args)
            return stmt
        except Exception as e:
            import sys
            print(f"[D1 execute error] {e}", file=sys.stderr)
            raise

    def _query(self, sql, params=None):
        stmt = self._execute(sql, params)
        result = stmt.all()
        results = getattr(result, "results", None) or result or []
        return list(results)

    def _query_one(self, sql, params=None):
        rows = self._query(sql, params)
        return rows[0] if rows else None

    def _execute_run(self, sql, params=None):
        stmt = self._execute(sql, params)
        result = stmt.run()
        return result

    def _last_insert_rowid(self, result):
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("last_row_id", 0) or 0)

    def init_schema(self) -> None:
        if self._init_schema_done:
            return
        try:
            for statement in D1_SCHEMA_SQL.split(";"):
                statement = statement.strip()
                if statement and not statement.startswith("--"):
                    try:
                        self._execute_run(statement)
                    except Exception:
                        pass
            try:
                cols_result = self._query("PRAGMA table_info(users)")
                cols = {r.get("name", "") for r in cols_result} if cols_result else set()
                for col_sql in [
                    "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN last_failed_at TIMESTAMP",
                    "ALTER TABLE users ADD COLUMN locked_until TIMESTAMP",
                    "ALTER TABLE users ADD COLUMN nickname VARCHAR(32) NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN phone VARCHAR(20) NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
                    "ALTER TABLE users ADD COLUMN role INTEGER NOT NULL DEFAULT 0",
                ]:
                    col_name = col_sql.split("ADD COLUMN ")[1].split(" ")[0]
                    if col_name not in cols:
                        try:
                            self._execute_run(col_sql)
                        except Exception:
                            pass
                s_cols_result = self._query("PRAGMA table_info(session_logs)")
                s_cols = {r.get("name", "") for r in s_cols_result} if s_cols_result else set()
                for col_sql in [
                    "ALTER TABLE session_logs ADD COLUMN fail_reason VARCHAR(40) NOT NULL DEFAULT ''",
                    "ALTER TABLE session_logs ADD COLUMN is_success BOOLEAN NOT NULL DEFAULT 1",
                    "ALTER TABLE session_logs ADD COLUMN attempt_account CHAR(6) NOT NULL DEFAULT ''",
                ]:
                    col_name = col_sql.split("ADD COLUMN ")[1].split(" ")[0]
                    if col_name not in s_cols:
                        try:
                            self._execute_run(col_sql)
                        except Exception:
                            pass
            except Exception:
                pass
            try:
                self.ensure_admin_seeded()
            except Exception:
                pass
            self._init_schema_done = True
        except Exception as e:
            import sys
            print(f"[D1 init_schema error] {e}", file=sys.stderr)

    def ensure_admin_seeded(self) -> int:
        import config
        admin_acc = str(getattr(config, "ADMIN_DEFAULT_ACCOUNT", "100000") or "100000").strip()[:6]
        admin_pwd = str(getattr(config, "ADMIN_DEFAULT_PASSWORD", "123456") or "123456").strip()[:6]
        admin_role = int(getattr(config, "ROLE_ADMIN", 1))
        disable_default = bool(getattr(config, "DISABLE_DEFAULT_ADMIN", False))
        existing_admin = self._query_one(
            "SELECT id FROM users WHERE is_deleted = 0 AND role = ? LIMIT 1",
            [admin_role],
        )
        if existing_admin:
            return int(existing_admin.get("id", 0) or 0)
        if disable_default:
            return 0
        import re
        from werkzeug.security import generate_password_hash
        if not re.fullmatch(r"\d{6}", admin_acc) or not re.fullmatch(r"\d{6}", admin_pwd):
            admin_acc = "100000"
            admin_pwd = "123456"
        u = self._query_one(
            "SELECT id, role FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1",
            [admin_acc],
        )
        if u:
            if int(u.get("role", 0) or 0) != admin_role:
                self._execute_run(
                    "UPDATE users SET role = ?, is_active = 1 WHERE id = ?",
                    [admin_role, int(u.get("id", 0))],
                )
            return int(u.get("id", 0) or 0)
        iters = int(getattr(config, "PBKDF2_ITERATIONS", 260000))
        pwd_hash = generate_password_hash(admin_pwd, method=f"pbkdf2:sha256:{iters}")
        result = self._execute_run(
            "INSERT INTO users(account_no, password_hash, role, nickname, is_active) VALUES(?,?,?,?,1)",
            [admin_acc, pwd_hash, admin_role, "超级管理员"],
        )
        uid = self._last_insert_rowid(result)
        for idx, (typ, names) in enumerate(getattr(config, "SYSTEM_CATEGORIES", {}).items()):
            for i, n in enumerate(names):
                try:
                    self._execute_run(
                        """INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort)
                           VALUES(?,?,?,1,?)""",
                        [uid, typ, n, idx * 100 + i],
                    )
                except Exception:
                    pass
        return uid

    def get_user_by_account(self, account_no: str) -> Optional[Dict[str, Any]]:
        row = self._query_one(
            "SELECT * FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1",
            [account_no],
        )
        return dict(row) if row else None

    def get_user_by_phone(self, phone: str) -> Optional[Dict[str, Any]]:
        row = self._query_one(
            "SELECT * FROM users WHERE phone = ? AND is_deleted = 0 LIMIT 1",
            [phone],
        )
        return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        row = self._query_one(
            "SELECT * FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1",
            [int(user_id)],
        )
        return dict(row) if row else None

    def create_user(self, account_no: str, password_hash: str, *, role: Optional[int] = None, nickname: str = "", phone: str = "") -> int:
        import config
        default_role = int(role) if role is not None else int(getattr(config, "ROLE_USER", 0))
        result = self._execute_run(
            "INSERT INTO users(account_no, password_hash, role, nickname, phone) VALUES(?,?,?,?,?)",
            [account_no, password_hash, default_role, (nickname or "")[:32], (phone or "")[:20]],
        )
        return self._last_insert_rowid(result)

    def update_user_last_login(self, user_id: int) -> None:
        self._execute_run(
            "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
            [int(user_id)],
        )

    def check_login_lock_status(self, *, user_id: Optional[int] = None, account_no: Optional[str] = None):
        if not user_id and not account_no:
            return False, None, 0, 0
        if user_id:
            row = self._query_one(
                "SELECT failed_attempts, locked_until, "
                " CASE WHEN locked_until IS NOT NULL AND locked_until > datetime('now') THEN 1 ELSE 0 END AS is_locked,"
                " CAST(CASE WHEN locked_until IS NOT NULL THEN strftime('%s', locked_until) - strftime('%s','now') ELSE 0 END AS INTEGER) AS remain_sec"
                " FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1",
                [int(user_id)],
            )
        else:
            row = self._query_one(
                "SELECT failed_attempts, locked_until, "
                " CASE WHEN locked_until IS NOT NULL AND locked_until > datetime('now') THEN 1 ELSE 0 END AS is_locked,"
                " CAST(CASE WHEN locked_until IS NOT NULL THEN strftime('%s', locked_until) - strftime('%s','now') ELSE 0 END AS INTEGER) AS remain_sec"
                " FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1",
                [str(account_no).strip()[:6]],
            )
        if not row:
            return False, None, 0, 0
        failed = int(row.get("failed_attempts", 0) or 0)
        locked = bool(row.get("is_locked", 0))
        remain = max(0, int(row.get("remain_sec", 0) or 0))
        locked_until = row.get("locked_until", None) if locked else None
        if not locked and remain <= 0:
            locked_until = None
        return locked, locked_until, failed, remain

    def increment_login_failure(self, *, user_id: Optional[int], account_no: Optional[str] = None) -> int:
        if user_id:
            row = self._query_one("SELECT COALESCE(failed_attempts,0) as fa FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1", [int(user_id)])
            cond, val = "id = ?", int(user_id)
        elif account_no:
            row = self._query_one("SELECT COALESCE(failed_attempts,0) as fa, id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1", [str(account_no).strip()[:6]])
            if row:
                user_id = int(row.get("id", 0) or 0)
            cond, val = "account_no = ?", str(account_no).strip()[:6]
        else:
            return 0
        if not row:
            return 0
        current = int(row.get("fa", 0) or 0) + 1
        import config
        max_attempts = int(getattr(config, "LOGIN_MAX_ATTEMPTS", 5))
        lock_minutes = int(getattr(config, "LOGIN_LOCK_MINUTES", 30))
        if current >= max_attempts:
            self._execute_run(
                f"UPDATE users SET failed_attempts = ?, last_failed_at = datetime('now'), locked_until = datetime('now', '+{lock_minutes} minutes') WHERE {cond}",
                [current, val],
            )
        else:
            self._execute_run(
                f"UPDATE users SET failed_attempts = ?, last_failed_at = datetime('now') WHERE {cond}",
                [current, val],
            )
        return current

    def reset_login_failures(self, *, user_id: Optional[int] = None, account_no: Optional[str] = None) -> None:
        if user_id:
            self._execute_run(
                "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_failed_at = NULL WHERE id = ?",
                [int(user_id)],
            )
        elif account_no:
            self._execute_run(
                "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_failed_at = NULL WHERE account_no = ?",
                [str(account_no).strip()[:6]],
            )

    def delete_user_cascade(self, user_id: int) -> None:
        self._execute_run("DELETE FROM transactions WHERE user_id = ?", [int(user_id)])
        self._execute_run("DELETE FROM reminders WHERE user_id = ?", [int(user_id)])
        self._execute_run("DELETE FROM categories WHERE user_id = ?", [int(user_id)])
        self._execute_run("DELETE FROM session_logs WHERE user_id = ?", [int(user_id)])
        self._execute_run("DELETE FROM users WHERE id = ?", [int(user_id)])

    def change_password(self, user_id: int, new_hash: str) -> None:
        self._execute_run(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            [new_hash, int(user_id)],
        )

    def upsert_system_categories_for_user(self, user_id: int) -> None:
        import config
        for idx, (typ, names) in enumerate(getattr(config, "SYSTEM_CATEGORIES", {}).items()):
            for i, n in enumerate(names):
                try:
                    self._execute_run(
                        """INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort)
                           VALUES(?,?,?,1,?)""",
                        [int(user_id), typ, n, idx * 100 + i],
                    )
                except Exception:
                    pass

    def insert_session_log(self, user_id: int, jti: str, ip: str, ua: str, *, is_success: bool = True, fail_reason: str = "", attempt_account: str = "") -> None:
        self._execute_run(
            """INSERT INTO session_logs(user_id, jti, ip, user_agent, is_success, fail_reason, attempt_account)
               VALUES(?,?,?,?,?,?,?)""",
            [int(user_id), jti, ip or "", (ua or "")[:512], 1 if is_success else 0, (fail_reason or "")[:40], (attempt_account or "")[:6]],
        )

    def revoke_jti(self, jti: str) -> None:
        self._execute_run(
            "UPDATE session_logs SET revoked = 1 WHERE jti = ?",
            [jti],
        )

    def is_jti_revoked(self, jti: str) -> bool:
        row = self._query_one(
            "SELECT revoked FROM session_logs WHERE jti = ? LIMIT 1",
            [jti],
        )
        return bool(row and row.get("revoked", 0))

    def list_transactions(self, user_id: int, filters: Dict[str, Any], page: int, page_size: int) -> Dict[str, Any]:
        where = ["user_id = ?", "deleted = 0"]
        args = [int(user_id)]
        if filters.get("type"):
            where.append("type = ?")
            args.append(filters["type"])
        if filters.get("category"):
            where.append("category = ?")
            args.append(filters["category"])
        if filters.get("room_no"):
            where.append("room_no = ?")
            args.append(filters["room_no"])
        if filters.get("start_date"):
            where.append("trans_date >= ?")
            args.append(filters["start_date"])
        if filters.get("end_date"):
            where.append("trans_date <= ?")
            args.append(filters["end_date"])
        if filters.get("keyword"):
            where.append("(description LIKE ? OR tag LIKE ?)")
            kw = f"%{filters['keyword']}%"
            args.extend([kw, kw])
        where_sql = " AND ".join(where)
        count_row = self._query_one(
            f"SELECT COUNT(*) as cnt FROM transactions WHERE {where_sql}",
            args,
        )
        total = int(count_row.get("cnt", 0) if count_row else 0)
        offset = (page - 1) * page_size
        rows = self._query(
            f"SELECT * FROM transactions WHERE {where_sql} ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?",
            args + [page_size, offset],
        )
        return {"total": total, "page": page, "page_size": page_size, "list": [dict(r) for r in rows]}

    def get_transaction(self, user_id: int, tx_id: int) -> Optional[Dict[str, Any]]:
        row = self._query_one(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1",
            [int(tx_id), int(user_id)],
        )
        return dict(row) if row else None

    def create_transaction(self, user_id: int, payload: Dict[str, Any]) -> int:
        result = self._execute_run(
            """INSERT INTO transactions(user_id, type, category, amount, description, room_no, trans_date, tag)
               VALUES(?,?,?,?,?,?,?,?)""",
            [
                int(user_id),
                payload.get("type", "支出"),
                payload.get("category", ""),
                float(payload.get("amount", 0)),
                payload.get("description", ""),
                payload.get("room_no", ""),
                payload.get("trans_date", ""),
                payload.get("tag", ""),
            ],
        )
        return self._last_insert_rowid(result)

    def update_transaction(self, user_id: int, tx_id: int, payload: Dict[str, Any]) -> bool:
        fields = []
        args = []
        for k in ("type", "category", "amount", "description", "room_no", "trans_date", "tag"):
            if k in payload:
                fields.append(f"{k} = ?")
                args.append(payload[k])
        if not fields:
            return False
        fields.append("updated_at = CURRENT_TIMESTAMP")
        args.extend([int(tx_id), int(user_id)])
        result = self._execute_run(
            f"UPDATE transactions SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
            args,
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def delete_transaction(self, user_id: int, tx_id: int) -> bool:
        result = self._execute_run(
            "UPDATE transactions SET deleted = 1 WHERE id = ? AND user_id = ?",
            [int(tx_id), int(user_id)],
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def delete_transactions_batch(self, user_id: int, ids: List[int]) -> int:
        if not ids:
            return 0
        placeholders = ",".join(["?"] * len(ids))
        args = [int(x) for x in ids] + [int(user_id)]
        result = self._execute_run(
            f"UPDATE transactions SET deleted = 1 WHERE id IN ({placeholders}) AND user_id = ?",
            args,
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0)

    def list_categories_grouped(self, user_id: int) -> Dict[str, List[Dict[str, Any]]]:
        rows = self._query(
            "SELECT * FROM categories WHERE user_id = ? AND disabled = 0 ORDER BY sort ASC, id ASC",
            [int(user_id)],
        )
        result = {"收入": [], "支出": []}
        for r in rows:
            typ = r.get("type", "支出")
            if typ in result:
                result[typ].append(dict(r))
        return result

    def list_reminders(self, user_id: int, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        where = ["user_id = ?", "deleted = 0"]
        args = [int(user_id)]
        if filters.get("status"):
            where.append("status = ?")
            args.append(filters["status"])
        if filters.get("room_no"):
            where.append("room_no = ?")
            args.append(filters["room_no"])
        where_sql = " AND ".join(where)
        rows = self._query(
            f"SELECT * FROM reminders WHERE {where_sql} ORDER BY due_date ASC, id DESC",
            args,
        )
        return [dict(r) for r in rows]

    def get_reminder(self, user_id: int, rem_id: int) -> Optional[Dict[str, Any]]:
        row = self._query_one(
            "SELECT * FROM reminders WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1",
            [int(rem_id), int(user_id)],
        )
        return dict(row) if row else None

    def create_reminder(self, user_id: int, payload: Dict[str, Any]) -> int:
        result = self._execute_run(
            """INSERT INTO reminders(user_id, room_no, rent_amount, due_date, lease_end_date, status, remark)
               VALUES(?,?,?,?,?,?,?)""",
            [
                int(user_id),
                payload.get("room_no", ""),
                float(payload.get("rent_amount", 0)),
                payload.get("due_date", ""),
                payload.get("lease_end_date") or None,
                payload.get("status", "未完成"),
                payload.get("remark", ""),
            ],
        )
        return self._last_insert_rowid(result)

    def update_reminder(self, user_id: int, rem_id: int, payload: Dict[str, Any]) -> bool:
        fields = []
        args = []
        for k in ("room_no", "rent_amount", "due_date", "lease_end_date", "status", "remark"):
            if k in payload:
                fields.append(f"{k} = ?")
                args.append(payload[k])
        if not fields:
            return False
        fields.append("updated_at = CURRENT_TIMESTAMP")
        args.extend([int(rem_id), int(user_id)])
        result = self._execute_run(
            f"UPDATE reminders SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
            args,
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def delete_reminder(self, user_id: int, rem_id: int) -> bool:
        result = self._execute_run(
            "UPDATE reminders SET deleted = 1 WHERE id = ? AND user_id = ?",
            [int(rem_id), int(user_id)],
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def aggregate_summary(self, user_id: int) -> Dict[str, Any]:
        income_row = self._query_one(
            "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id = ? AND type = '收入' AND deleted = 0",
            [int(user_id)],
        )
        expense_row = self._query_one(
            "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id = ? AND type = '支出' AND deleted = 0",
            [int(user_id)],
        )
        month_income_row = self._query_one(
            "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id = ? AND type = '收入' AND deleted = 0 AND strftime('%Y-%m', trans_date) = strftime('%Y-%m', 'now')",
            [int(user_id)],
        )
        month_expense_row = self._query_one(
            "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id = ? AND type = '支出' AND deleted = 0 AND strftime('%Y-%m', trans_date) = strftime('%Y-%m', 'now')",
            [int(user_id)],
        )
        tx_count_row = self._query_one(
            "SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND deleted = 0",
            [int(user_id)],
        )
        rem_pending_row = self._query_one(
            "SELECT COUNT(*) as cnt FROM reminders WHERE user_id = ? AND deleted = 0 AND status = '未完成'",
            [int(user_id)],
        )
        return {
            "total_income": float(income_row.get("total", 0) if income_row else 0),
            "total_expense": float(expense_row.get("total", 0) if expense_row else 0),
            "month_income": float(month_income_row.get("total", 0) if month_income_row else 0),
            "month_expense": float(month_expense_row.get("total", 0) if month_expense_row else 0),
            "transaction_count": int(tx_count_row.get("cnt", 0) if tx_count_row else 0),
            "pending_reminders": int(rem_pending_row.get("cnt", 0) if rem_pending_row else 0),
        }

    def recent_transactions(self, user_id: int, limit: int) -> List[Dict[str, Any]]:
        rows = self._query(
            "SELECT * FROM transactions WHERE user_id = ? AND deleted = 0 ORDER BY trans_date DESC, id DESC LIMIT ?",
            [int(user_id), int(limit)],
        )
        return [dict(r) for r in rows]

    def all_reminders_uncompleted(self, user_id: int) -> List[Dict[str, Any]]:
        rows = self._query(
            "SELECT * FROM reminders WHERE user_id = ? AND deleted = 0 AND status = '未完成' ORDER BY due_date ASC",
            [int(user_id)],
        )
        return [dict(r) for r in rows]

    def trend_12m(self, user_id: int) -> List[Dict[str, Any]]:
        rows = self._query(
            """SELECT strftime('%Y-%m', trans_date) as month, type, COALESCE(SUM(amount),0) as total
               FROM transactions WHERE user_id = ? AND deleted = 0
               AND trans_date >= date('now', '-11 months', 'start of month')
               GROUP BY strftime('%Y-%m', trans_date), type
               ORDER BY month ASC""",
            [int(user_id)],
        )
        return [dict(r) for r in rows]

    def category_pie(self, user_id: int, scope_months: int) -> Dict[str, List[Dict[str, Any]]]:
        where = ["user_id = ?", "deleted = 0"]
        args = [int(user_id)]
        if scope_months and scope_months > 0:
            where.append(f"trans_date >= date('now', '-{int(scope_months)} months')")
        where_sql = " AND ".join(where)
        income_rows = self._query(
            f"""SELECT category, COALESCE(SUM(amount),0) as total, COUNT(*) as count
                FROM transactions WHERE {where_sql} AND type = '收入'
                GROUP BY category ORDER BY total DESC""",
            args,
        )
        expense_rows = self._query(
            f"""SELECT category, COALESCE(SUM(amount),0) as total, COUNT(*) as count
                FROM transactions WHERE {where_sql} AND type = '支出'
                GROUP BY category ORDER BY total DESC""",
            args,
        )
        return {
            "收入": [dict(r) for r in income_rows],
            "支出": [dict(r) for r in expense_rows],
        }

    def category_compare(self, user_id: int, scope_months: int) -> Dict[str, Any]:
        pie = self.category_pie(user_id, scope_months)
        total_income = sum(float(r.get("total", 0)) for r in pie["收入"])
        total_expense = sum(float(r.get("total", 0)) for r in pie["支出"])
        return {
            "total_income": total_income,
            "total_expense": total_expense,
            "net": total_income - total_expense,
            "income_categories": pie["收入"],
            "expense_categories": pie["支出"],
        }

    def admin_list_users(self, page: int, page_size: int, filters: Dict[str, Any]) -> Dict[str, Any]:
        where = ["is_deleted = 0"]
        args = []
        if filters.get("keyword"):
            where.append("(account_no LIKE ? OR nickname LIKE ?)")
            kw = f"%{filters['keyword']}%"
            args.extend([kw, kw])
        if filters.get("role") is not None:
            where.append("role = ?")
            args.append(int(filters["role"]))
        where_sql = " AND ".join(where)
        count_row = self._query_one(f"SELECT COUNT(*) as cnt FROM users WHERE {where_sql}", args)
        total = int(count_row.get("cnt", 0) if count_row else 0)
        offset = (page - 1) * page_size
        rows = self._query(
            f"SELECT id, account_no, nickname, role, is_active, created_at, last_login_at FROM users WHERE {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?",
            args + [page_size, offset],
        )
        return {"total": total, "page": page, "page_size": page_size, "list": [dict(r) for r in rows]}

    def admin_toggle_user_active(self, user_id: int, active: bool) -> bool:
        result = self._execute_run(
            "UPDATE users SET is_active = ? WHERE id = ?",
            [1 if active else 0, int(user_id)],
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def admin_delete_user(self, user_id: int) -> bool:
        self.delete_user_cascade(int(user_id))
        return True

    def admin_announcement_list(self, page: int, page_size: int) -> Dict[str, Any]:
        count_row = self._query_one("SELECT COUNT(*) as cnt FROM announcements WHERE is_deleted = 0", [])
        total = int(count_row.get("cnt", 0) if count_row else 0)
        offset = (page - 1) * page_size
        rows = self._query(
            "SELECT * FROM announcements WHERE is_deleted = 0 ORDER BY priority DESC, id DESC LIMIT ? OFFSET ?",
            [page_size, offset],
        )
        return {"total": total, "page": page, "page_size": page_size, "list": [dict(r) for r in rows]}

    def admin_create_announcement(self, payload: Dict[str, Any], created_by: int) -> int:
        result = self._execute_run(
            """INSERT INTO announcements(title, content, banner_level, priority, is_pinned, is_active, effective_at, expire_at, created_by, updated_by)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            [
                payload.get("title", ""),
                payload.get("content", ""),
                payload.get("banner_level", "info"),
                int(payload.get("priority", 0)),
                1 if payload.get("is_pinned") else 0,
                1 if payload.get("is_active", True) else 0,
                payload.get("effective_at") or None,
                payload.get("expire_at") or None,
                int(created_by),
                int(created_by),
            ],
        )
        return self._last_insert_rowid(result)

    def admin_update_announcement(self, ann_id: int, payload: Dict[str, Any], updated_by: int) -> bool:
        fields = []
        args = []
        for k in ("title", "content", "banner_level", "priority", "is_pinned", "is_active", "effective_at", "expire_at"):
            if k in payload:
                fields.append(f"{k} = ?")
                if k in ("is_pinned", "is_active"):
                    args.append(1 if payload[k] else 0)
                else:
                    args.append(payload[k])
        if not fields:
            return False
        fields.append("updated_by = ?")
        args.append(int(updated_by))
        fields.append("updated_at = CURRENT_TIMESTAMP")
        args.append(int(ann_id))
        result = self._execute_run(
            f"UPDATE announcements SET {', '.join(fields)} WHERE id = ?",
            args,
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def admin_delete_announcement(self, ann_id: int) -> bool:
        result = self._execute_run(
            "UPDATE announcements SET is_deleted = 1 WHERE id = ?",
            [int(ann_id)],
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def active_announcements(self) -> List[Dict[str, Any]]:
        rows = self._query(
            """SELECT * FROM announcements WHERE is_active = 1 AND is_deleted = 1 = 0
               AND (effective_at IS NULL OR effective_at <= datetime('now'))
               AND (expire_at IS NULL OR expire_at >= datetime('now'))
               ORDER BY priority DESC, id DESC""",
            [],
        )
        return [dict(r) for r in rows]

    def captcha_store_save(self, captcha_id: str, code_hash: str, salt: str, expires_at: str) -> None:
        self._execute_run(
            "INSERT OR REPLACE INTO captcha_store(id, code_hash, salt, expires_at) VALUES(?,?,?,?)",
            [captcha_id, code_hash, salt, expires_at],
        )

    def captcha_store_get(self, captcha_id: str) -> Optional[Dict[str, Any]]:
        row = self._query_one(
            "SELECT * FROM captcha_store WHERE id = ? LIMIT 1",
            [captcha_id],
        )
        return dict(row) if row else None

    def captcha_store_mark_used(self, captcha_id: str) -> bool:
        result = self._execute_run(
            "UPDATE captcha_store SET used = 1 WHERE id = ? AND used = 0",
            [captcha_id],
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0) > 0

    def captcha_store_cleanup_expired(self) -> int:
        result = self._execute_run(
            "DELETE FROM captcha_store WHERE expires_at < datetime('now')",
            [],
        )
        meta = getattr(result, "meta", None) or {}
        return int(meta.get("changes", 0) or 0)
