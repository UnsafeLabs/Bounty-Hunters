<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class NotificationPreferenceController extends Controller
{
    /**
     * List all notification preferences for the authenticated user.
     */
    public function index()
    {
        $preferences = Auth::user()
            ->notificationPreferences()
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json($preferences);
    }

    /**
     * Update a single preference.
     */
    public function update(Request $request, $id)
    {
        $preference = NotificationPreference::where('id', $id)
            ->where('user_id', Auth::id())
            ->firstOrFail();

        $validated = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        $preference->update($validated);

        return response()->json($preference);
    }

    /**
     * Bulk update preferences.
     *
     * Expected payload:
     * [
     *   { "id": 1, "enabled": true },
     *   { "id": 2, "enabled": false },
     *   ...
     * ]
     */
    public function bulkUpdate(Request $request)
    {
        $validated = $request->validate([
            '*.id' => ['required', 'integer', Rule::exists('notification_preferences', 'id')
                ->where('user_id', Auth::id())],
            '*.enabled' => 'required|boolean',
        ]);

        foreach ($validated as $item) {
            NotificationPreference::where('id', $item['id'])
                ->where('user_id', Auth::id())
                ->update(['enabled' => $item['enabled']]);
        }

        $preferences = Auth::user()
            ->notificationPreferences()
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json($preferences);
    }
}
