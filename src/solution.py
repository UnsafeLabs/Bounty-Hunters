class NotificationPreference:
    def __init__(self, user_id: int, channel: str, event_type: str, enabled: bool = True, pref_id: int = None):
        self.id = pref_id or id(self)
        self.user_id = user_id
        self.channel = channel
        self.event_type = event_type
        self.enabled = enabled


class NotificationPreferenceController:
    def __init__(self, db_session):
        self.db = db_session

    def index(self, user_id: int):
        return [p for p in self.db if p.user_id == user_id]

    def update(self, user_id: int, preference_id: int, enabled: bool):
        for p in self.db:
            if p.user_id == user_id and getattr(p, 'id', id(p)) == preference_id:
                p.enabled = enabled
                return p
        raise ValueError("Preference not found")

    def bulk_update(self, user_id: int, preferences: list):
        updated = []
        for item in preferences:
            found = False
            for p in self.db:
                if p.user_id == user_id and p.channel == item['channel'] and p.event_type == item['event_type']:
                    p.enabled = item['enabled']
                    updated.append(p)
                    found = True
                    break
            if not found:
                new_p = NotificationPreference(user_id, item['channel'], item['event_type'], item['enabled'])
                self.db.append(new_p)
                updated.append(new_p)
        return updated


class NotificationRouter:
    def __init__(self, controller: NotificationPreferenceController):
        self.controller = controller

    def should_send(self, user_id: int, channel: str, event_type: str) -> bool:
        preferences = self.controller.index(user_id)
        for p in preferences:
            if p.channel == channel and p.event_type == event_type:
                return p.enabled
        return True  # Default to allowed if no preference set
