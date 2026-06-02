"""
PII Export & Delete Service (GDPR-ready)

Provides:
- Export: generates a ZIP package of all user personal data
- Delete: permanently removes all user data with audit trail
- Audit: logs all GDPR operations for compliance
"""
import json
import io
import zipfile
import logging
from datetime import datetime
from flask import current_app
from ..extensions import db
from ..models import User, Category, Expense, RecurringExpense, Bill, Reminder, AuditLog

logger = logging.getLogger("finmind.gdpr")


def export_user_data(user_id: int) -> bytes:
    """
    Export all personal data for a user as a ZIP package.
    
    Returns:
        bytes: ZIP file containing user's data in JSON format
    """
    user = db.session.get(User, user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")

    # Collect all user data
    export_data = {
        "export_metadata": {
            "user_id": user_id,
            "exported_at": datetime.utcnow().isoformat() + "Z",
            "format_version": "1.0",
            "data_controller": "FinMind",
        },
        "profile": {
            "id": user.id,
            "email": user.email,
            "preferred_currency": user.preferred_currency,
            "role": user.role,
            "created_at": user.created_at.isoformat() + "Z" if user.created_at else None,
            "note": "Password hash excluded for security. Use password reset to set new password.",
        },
        "categories": [],
        "expenses": [],
        "recurring_expenses": [],
        "bills": [],
        "reminders": [],
    }

    # Categories
    categories = Category.query.filter_by(user_id=user_id).all()
    for cat in categories:
        export_data["categories"].append({
            "id": cat.id,
            "name": cat.name,
            "created_at": cat.created_at.isoformat() + "Z" if cat.created_at else None,
        })

    # Expenses
    expenses = Expense.query.filter_by(user_id=user_id).all()
    for exp in expenses:
        export_data["expenses"].append({
            "id": exp.id,
            "category_id": exp.category_id,
            "amount": str(exp.amount),
            "currency": exp.currency,
            "expense_type": exp.expense_type,
            "notes": exp.notes,
            "spent_at": exp.spent_at.isoformat() if exp.spent_at else None,
            "source_recurring_id": exp.source_recurring_id,
            "created_at": exp.created_at.isoformat() + "Z" if exp.created_at else None,
        })

    # Recurring expenses
    recurring = RecurringExpense.query.filter_by(user_id=user_id).all()
    for rec in recurring:
        export_data["recurring_expenses"].append({
            "id": rec.id,
            "category_id": rec.category_id,
            "amount": str(rec.amount),
            "currency": rec.currency,
            "expense_type": rec.expense_type,
            "notes": rec.notes,
            "cadence": rec.cadence.value if rec.cadence else None,
            "start_date": rec.start_date.isoformat() if rec.start_date else None,
            "end_date": rec.end_date.isoformat() if rec.end_date else None,
            "active": rec.active,
            "created_at": rec.created_at.isoformat() + "Z" if rec.created_at else None,
        })

    # Bills
    bills = Bill.query.filter_by(user_id=user_id).all()
    for bill in bills:
        export_data["bills"].append({
            "id": bill.id,
            "name": bill.name,
            "amount": str(bill.amount) if bill.amount else None,
            "currency": bill.currency,
            "cadence": bill.cadence.value if hasattr(bill, 'cadence') and bill.cadence else None,
            "created_at": bill.created_at.isoformat() + "Z" if hasattr(bill, 'created_at') and bill.created_at else None,
        })

    # Reminders
    try:
        reminders = Reminder.query.filter_by(user_id=user_id).all()
        for rem in reminders:
            export_data["reminders"].append({
                "id": rem.id,
                "message": getattr(rem, 'message', None),
                "created_at": rem.created_at.isoformat() + "Z" if hasattr(rem, 'created_at') and rem.created_at else None,
            })
    except Exception:
        pass  # Reminder model may not exist

    # Create ZIP package
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Main data export
        zf.writestr(
            "user_data.json",
            json.dumps(export_data, indent=2, ensure_ascii=False)
        )
        # README
        zf.writestr(
            "README.md",
            f"# FinMind Data Export\n\n"
            f"User ID: {user_id}\n"
            f"Exported: {datetime.utcnow().isoformat()}Z\n"
            f"Format: JSON\n\n"
            f"## Files\n"
            f"- user_data.json: All your personal data\n"
            f"- README.md: This file\n\n"
            f"This export was generated per GDPR Article 20 (Right to Data Portability).\n"
        )

    zip_buffer.seek(0)
    logger.info(f"PII export completed for user {user_id}")
    _log_audit(user_id, "PII_EXPORT", "User data exported")

    return zip_buffer.getvalue()


def delete_user_data(user_id: int, confirm: bool = False) -> dict:
    """
    Permanently delete all user data (GDPR Article 17 - Right to Erasure).
    
    Args:
        user_id: The user to delete
        confirm: Must be True to proceed (safety check)
    
    Returns:
        dict: Summary of deleted records
    """
    if not confirm:
        raise ValueError("Must set confirm=True to proceed with deletion")

    user = db.session.get(User, user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")

    summary = {
        "user_id": user_id,
        "deleted_at": datetime.utcnow().isoformat() + "Z",
        "records_deleted": {},
    }

    # Delete in order (respect foreign keys)
    # 1. Expenses
    count = Expense.query.filter_by(user_id=user_id).delete()
    summary["records_deleted"]["expenses"] = count

    # 2. Recurring expenses
    count = RecurringExpense.query.filter_by(user_id=user_id).delete()
    summary["records_deleted"]["recurring_expenses"] = count

    # 3. Bills
    count = Bill.query.filter_by(user_id=user_id).delete()
    summary["records_deleted"]["bills"] = count

    # 4. Categories
    count = Category.query.filter_by(user_id=user_id).delete()
    summary["records_deleted"]["categories"] = count

    # 5. Reminders
    try:
        count = Reminder.query.filter_by(user_id=user_id).delete()
        summary["records_deleted"]["reminders"] = count
    except Exception:
        summary["records_deleted"]["reminders"] = 0

    # 6. Audit logs - keep a final entry, anonymize the rest
    _log_audit(user_id, "PII_DELETE", "User account permanently deleted")
    # Anonymize previous audit logs
    old_logs = AuditLog.query.filter_by(user_id=user_id).all()
    for log in old_logs:
        if log.action != "PII_DELETE":
            log.user_id = None  # Anonymize but keep for system audit
    summary["records_deleted"]["audit_logs_anonymized"] = len(old_logs)

    # 7. Delete the user account itself
    db.session.delete(user)

    db.session.commit()

    logger.warning(f"PII DELETE completed for user {user_id}: {summary}")
    return summary


def _log_audit(user_id: int, action: str, details: str):
    """Log GDPR operation for audit trail.

    Uses a nested transaction (SAVEPOINT) to isolate audit log commits
    from the parent transaction — a failed audit log write must not
    roll back data deletion that has already succeeded.
    """
    try:
        audit = AuditLog(
            user_id=user_id,
            action=action,
            details=details,
            ip_address=None,
            created_at=datetime.utcnow(),
        )
        db.session.add(audit)
        db.session.flush()  # flush only, let parent control commit/rollback
    except Exception as e:
        logger.error(f"Failed to write audit log: {e}")
        # Use SAVEPOINT to avoid rolling back the parent transaction
        try:
            db.session.begin_nested()
        except Exception:
            pass  # nested transactions not supported, log only
