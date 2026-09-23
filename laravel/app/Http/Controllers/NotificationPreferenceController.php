<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $preferences = $request->user()->notificationPreferences()
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json($preferences);
    }

    public function update(Request $request, NotificationPreference $notificationPreference): JsonResponse
    {
        abort_unless($notificationPreference->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        $notificationPreference->update($validated);

        return response()->json($notificationPreference);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => 'required|array|min:1',
            'preferences.*.id' => 'required|integer|distinct|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean',
        ]);

        $preferences = $request->user()->notificationPreferences()
            ->whereIn('id', collect($validated['preferences'])->pluck('id'))
            ->get()
            ->keyBy('id');

        abort_unless($preferences->count() === count($validated['preferences']), 403);

        $updatedPreferences = DB::transaction(function () use ($preferences, $validated): Collection {
            foreach ($validated['preferences'] as $data) {
                $preferences->get($data['id'])->update(['enabled' => $data['enabled']]);
            }

            return $preferences->values();
        });

        return response()->json($updatedPreferences);
    }
}
