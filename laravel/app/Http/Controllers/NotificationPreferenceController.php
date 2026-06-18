<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->authenticatedUser($request);

        return response()->json(
            $user->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get()
        );
    }

    public function update(Request $request, NotificationPreference $preference): JsonResponse
    {
        $this->authorizePreference($request, $preference);

        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference->update($data);

        return response()->json($preference->refresh());
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $user = $this->authenticatedUser($request);

        $data = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => [
                'required',
                'integer',
                Rule::exists('notification_preferences', 'id')->where('user_id', $user->id),
            ],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        foreach ($data['preferences'] as $preference) {
            NotificationPreference::query()
                ->where('user_id', $user->id)
                ->whereKey($preference['id'])
                ->update(['enabled' => $preference['enabled']]);
        }

        return response()->json(
            $user->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get()
        );
    }

    private function authorizePreference(Request $request, NotificationPreference $preference): void
    {
        $user = $this->authenticatedUser($request);

        abort_unless($preference->user_id === $user->id, 404);
    }

    private function authenticatedUser(Request $request)
    {
        $user = $request->user();

        abort_unless($user, 401);

        return $user;
    }
}
