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

        if ($user === null) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return response()->json([
            'data' => $user->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get(),
        ]);
    }

    public function update(Request $request, NotificationPreference $notificationPreference): JsonResponse
    {
        $user = $request->user();

        if ($user === null) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($notificationPreference->user_id !== $user->id) {
            return response()->json(['message' => 'Preference does not belong to the authenticated user.'], 403);
        }

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $notificationPreference->update(['enabled' => $validated['enabled']]);

        return response()->json(['data' => $notificationPreference->refresh()]);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user === null) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer', 'distinct'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $updates = collect($validated['preferences']);
        $preferences = NotificationPreference::query()
            ->where('user_id', $user->id)
            ->whereIn('id', $updates->pluck('id'))
            ->get()
            ->keyBy('id');

        if ($preferences->count() !== $updates->count()) {
            return response()->json(['message' => 'One or more preferences do not belong to the authenticated user.'], 403);
        }

        DB::transaction(function () use ($updates, $preferences): void {
            foreach ($updates as $update) {
                $preferences->get($update['id'])->update(['enabled' => $update['enabled']]);
            }
        });

        return response()->json([
            'data' => NotificationPreference::query()
                ->whereIn('id', $updates->pluck('id'))
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get(),
        ]);
    }
}
