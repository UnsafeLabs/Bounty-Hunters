<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $preferences = NotificationPreference::where('user_id', Auth::id())
            ->get();

        return response()->json([
            'preferences' => $preferences->groupBy('channel'),
        ]);
    }

    public function update(Request $request, NotificationPreference $preference): JsonResponse
    {
        $this->authorizePreference($preference);

        $validated = $request->validate([
            'enabled' => 'boolean',
            'channel' => ['string', Rule::in(['mail', 'slack', 'database'])],
            'event_type' => 'string',
        ]);

        $preference->update($validated);

        return response()->json([
            'message' => 'Preference updated',
            'preference' => $preference->fresh(),
        ]);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => 'required|array',
            'preferences.*.channel' => ['required', 'string', Rule::in(['mail', 'slack', 'database'])],
            'preferences.*.event_type' => 'required|string',
            'preferences.*.enabled' => 'required|boolean',
        ]);

        $userId = Auth::id();
        $updated = 0;

        foreach ($validated['preferences'] as $pref) {
            $result = NotificationPreference::updateOrCreate(
                [
                    'user_id' => $userId,
                    'channel' => $pref['channel'],
                    'event_type' => $pref['event_type'],
                ],
                ['enabled' => $pref['enabled']]
            );
            $updated++;
        }

        return response()->json([
            'message' => 'Preferences updated',
            'updated' => $updated,
        ]);
    }

    private function authorizePreference(NotificationPreference $preference): void
    {
        if ($preference->user_id !== Auth::id()) {
            abort(403, 'You do not own this preference.');
        }
    }
}
