<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->resolveUser($request);

        return response()->json(
            $user->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get()
        );
    }

    public function update(Request $request, NotificationPreference $preference): JsonResponse
    {
        $this->authorizePreferenceAccess($request, $preference);

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference->update([
            'enabled' => $validated['enabled'],
        ]);

        return response()->json($preference->refresh());
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $user = $this->resolveUser($request);

        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $updates = collect($validated['preferences'])->keyBy('id');
        $preferences = $user->notificationPreferences()
            ->whereIn('id', $updates->keys())
            ->get();

        abort_unless($preferences->count() === $updates->count(), 404);

        foreach ($preferences as $preference) {
            $preference->update([
                'enabled' => $updates->get($preference->id)['enabled'],
            ]);
        }

        return response()->json(
            $user->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get()
        );
    }

    private function resolveUser(Request $request): User
    {
        $user = $request->user();

        if ($user instanceof User) {
            return $user;
        }

        $validated = $request->validate([
            'user_id' => ['required', 'integer', Rule::exists('users', 'id')],
        ]);

        return User::query()->findOrFail($validated['user_id']);
    }

    private function authorizePreferenceAccess(Request $request, NotificationPreference $preference): void
    {
        $user = $request->user();

        if ($user instanceof User) {
            abort_unless($preference->user_id === $user->id, 404);
        }
    }
}
