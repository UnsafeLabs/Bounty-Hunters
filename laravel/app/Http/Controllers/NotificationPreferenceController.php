<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request)
    {
        return NotificationPreference::where('user_id', $request->user()->id)->get();
    }

    public function update(Request $request, $id)
    {
        $pref = NotificationPreference::where('user_id', $request->user()->id)->findOrFail($id);
        $pref->update($request->validate([
            'channel' => 'required|string|in:mail,slack,database',
            'event_type' => 'required|string',
            'enabled' => 'required|boolean',
        ]));
        return $pref;
    }

    public function bulkUpdate(Request $request)
    {
        $data = $request->validate([
            'preferences' => 'required|array',
            'preferences.*.id' => 'required|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean',
        ]);
        foreach ($data['preferences'] as $pref) {
            NotificationPreference::where('user_id', $request->user()->id)
                ->where('id', $pref['id'])
                ->update(['enabled' => $pref['enabled']]);
        }
        return response()->json(['message' => 'Preferences updated']);
    }
}