<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        NotificationPreference::seedDefaultsFor($user);

        $preferences = NotificationPreference::query()
            ->whereBelongsTo($user)
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json(['data' => $preferences]);
    }

    public function update(Request $request, NotificationPreference $notificationPreference): JsonResponse
    {
        abort_unless($notificationPreference->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $notificationPreference->update($validated);

        return response()->json(['data' => $notificationPreference->fresh()]);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $updates = collect($validated['preferences'])->keyBy('id');
        $preferences = NotificationPreference::query()
            ->whereBelongsTo($request->user())
            ->whereIn('id', $updates->keys())
            ->get();

        abort_unless($preferences->count() === $updates->count(), 404);

        DB::transaction(function () use ($preferences, $updates): void {
            foreach ($preferences as $preference) {
                $preference->update([
                    'enabled' => $updates[$preference->id]['enabled'],
                ]);
            }
        });

        return response()->json([
            'data' => NotificationPreference::query()
                ->whereBelongsTo($request->user())
                ->whereIn('id', $updates->keys())
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get(),
        ]);
    }
}
