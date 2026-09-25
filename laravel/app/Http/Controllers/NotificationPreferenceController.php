<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class NotificationPreferenceController extends Controller
{
    public function index()
    {
        $user = Auth::user();
        return response()->json($user->notificationPreferences);
    }

    public function update(Request $request, $id)
    {
        $user = Auth::user();
        $preference = NotificationPreference::where('id', $id)
            ->where('user_id', $user->id)
            ->firstOrFail();

        $preference->update([
            'enabled' => $request->boolean('enabled', $preference->enabled),
        ]);

        return response()->json($preference);
    }

    public function bulkUpdate(Request $request)
    {
        $user = Auth::user();
        $updates = $request->input('preferences', []);

        foreach ($updates as $update) {
            $preference = NotificationPreference::where('id', $update['id'])
                ->where('user_id', $user->id)
                ->firstOrFail();

            $preference->update([
                'enabled' => $update['enabled'],
            ]);
        }

        return response()->json(['status' => 'success']);
    }
}
