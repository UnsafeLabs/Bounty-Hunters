<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class NotificationPreferenceController extends Controller
{
    public function index()
    {
        $prefs = Auth::user()->notificationPreferences;
        return response()->json($prefs);
    }

    public function update(Request $request, NotificationPreference $preference)
    {
        if ($preference->user_id !== Auth::id()) {
            abort(403);
        }

        $validated = $request->validate([
            "enabled" => "required|boolean",
        ]);

        $preference->update($validated);
        return response()->json($preference);
    }

    public function bulkUpdate(Request $request)
    {
        $validated = $request->validate([
            "preferences" => "required|array",
            "preferences.*.id" => "required|exists:notification_preferences,id",
            "preferences.*.enabled" => "required|boolean",
        ]);

        $user = Auth::user();
        $updated = [];

        foreach ($validated["preferences"] as $item) {
            $pref = NotificationPreference::where("id", $item["id"])
                ->where("user_id", $user->id)
                ->first();
            if ($pref) {
                $pref->update(["enabled" => $item["enabled"]]);
                $updated[] = $pref;
            }
        }

        return response()->json($updated);
    }
}
