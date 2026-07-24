from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from flask import g
import config

class DatabaseAdapter(ABC):
    @abstractmethod
    def init_schema(self) -> None: ...

    @abstractmethod
    def get_user_by_account(self, account_no: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def create_user(self, account_no: str, password_hash: str) -> int: ...

    @abstractmethod
    def update_user_last_login(self, user_id: int) -> None: ...

    @abstractmethod
    def delete_user_cascade(self, user_id: int) -> None: ...

    @abstractmethod
    def change_password(self, user_id: int, new_hash: str) -> None: ...

    @abstractmethod
    def upsert_system_categories_for_user(self, user_id: int) -> None: ...

    @abstractmethod
    def insert_session_log(self, user_id: int, jti: str, ip: str, ua: str) -> None: ...

    @abstractmethod
    def revoke_jti(self, jti: str) -> None: ...

    @abstractmethod
    def is_jti_revoked(self, jti: str) -> bool: ...

    @abstractmethod
    def list_transactions(self, user_id: int, filters: Dict[str, Any], page: int, page_size: int) -> Dict[str, Any]: ...

    @abstractmethod
    def get_transaction(self, user_id: int, tx_id: int) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def create_transaction(self, user_id: int, payload: Dict[str, Any]) -> int: ...

    @abstractmethod
    def update_transaction(self, user_id: int, tx_id: int, payload: Dict[str, Any]) -> bool: ...

    @abstractmethod
    def delete_transaction(self, user_id: int, tx_id: int) -> bool: ...

    @abstractmethod
    def delete_transactions_batch(self, user_id: int, ids: List[int]) -> int: ...

    @abstractmethod
    def list_categories_grouped(self, user_id: int) -> Dict[str, List[Dict[str, Any]]]: ...

    @abstractmethod
    def list_reminders(self, user_id: int, filters: Dict[str, Any]) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def get_reminder(self, user_id: int, rem_id: int) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def create_reminder(self, user_id: int, payload: Dict[str, Any]) -> int: ...

    @abstractmethod
    def update_reminder(self, user_id: int, rem_id: int, payload: Dict[str, Any]) -> bool: ...

    @abstractmethod
    def delete_reminder(self, user_id: int, rem_id: int) -> bool: ...

    @abstractmethod
    def aggregate_summary(self, user_id: int) -> Dict[str, Any]: ...

    @abstractmethod
    def recent_transactions(self, user_id: int, limit: int) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def all_reminders_uncompleted(self, user_id: int) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def trend_12m(self, user_id: int) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def category_pie(self, user_id: int, scope_months: int) -> Dict[str, List[Dict[str, Any]]]: ...

    @abstractmethod
    def category_compare(self, user_id: int, scope_months: int) -> Dict[str, Any]: ...

_adapter_singleton: Optional[DatabaseAdapter] = None

def get_adapter() -> DatabaseAdapter:
    global _adapter_singleton
    if _adapter_singleton is None:
        if config.DB_ADAPTER == "supabase":
            from .supabase_adapter import SupabaseAdapter
            _adapter_singleton = SupabaseAdapter()
        else:
            from .sqlite_adapter import SQLiteAdapter
            _adapter_singleton = SQLiteAdapter()
    return _adapter_singleton

def reset_adapter_for_tests():
    global _adapter_singleton
    _adapter_singleton = None
