"""
AuditLog model for GDPR compliance logging.
Add this to models.py in the FinMind backend.
"""
from datetime import datetime
from .extensions import db


class AuditLog(db.Model):
    """Audit trail for GDPR operations and security events."""
    __tablename__ = "audit_logs"
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    action = db.Column(db.String(50), nullable=False)  # PII_EXPORT, PII_DELETE, etc.
    details = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<AuditLog {self.action} user={self.user_id}>"
