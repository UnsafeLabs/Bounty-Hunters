<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\NotificationPreference;
use Illuminate\Support\Facades\Auth;

class NotificationPreferenceController extends Controller
{
    public function index()
    {
        $preferences = NotificationPreference::where('user_id', Auth::id())->get();
        return response()->json($preferences);
    }

    public function update(Request $request, $id)
    {
        $preference = NotificationPreference::where('user_id', Auth::id())->findOrFail($id);
        $preference->update($request->only('enabled'));
        return response()->json($preference);
    }

    public function bulkUpdate(Request $request)
    {
        $validated = $request->validate([
            'preferences' => 'required|array',
            'preferences.*.id' => 'required|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean'
        ]);

        $updated = [];
        foreach ($validated['preferences'] as $pref) {
            $preference = NotificationPreference::where('user_id', Auth::id())->findOrFail($pref['id']);
            $preference->update(['enabled' => $pref['enabled']]);
            $updated[] = $preference;
        }

        return response()->json($updated);
    }

    public function storeDefaultPreferences($userId)
    {
        $defaultEventTypes = ['user_registered', 'task_assigned', 'task_completed'];
        $channels = ['mail', 'slack', 'database'];
        
        foreach ($defaultEventTypes as $eventType) {
            foreach ($channels as $channel) {
                NotificationPreference::firstOrCreate(
                    [
                        'user_id' => $userId,
                        'channel' => $channel,
                        'event_type' => $eventType
                    ],
                    ['enabled' => true]
                );
            }
        }
    }
}