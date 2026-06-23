<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class NotificationPreferenceController extends Controller
{
    /**
     * List the authenticated user's notification preferences.
     */
    public function index(Request $request): JsonResponse
    {
        $preferences = $request->user()->notificationPreferences()
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json(['data' => $preferences]);
    }

    /**
     * Update a single preference, identified by its id, for the current user.
     *
     * Scoping the lookup to the user's own preferences makes a foreign or
     * unknown id resolve to a 404 rather than touching another user's row.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference = $request->user()->notificationPreferences()->findOrFail($id);
        $preference->update(['enabled' => $validated['enabled']]);

        return response()->json(['data' => $preference]);
    }

    /**
     * Update many of the current user's preferences in a single request. Every
     * id must belong to the authenticated user or the whole request is rejected.
     */
    public function bulkUpdate(Request $request): JsonResponse
    {
        $ownedIds = $request->user()->notificationPreferences()->pluck('id')->all();

        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer', Rule::in($ownedIds)],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        foreach ($validated['preferences'] as $preference) {
            $request->user()->notificationPreferences()
                ->whereKey($preference['id'])
                ->update(['enabled' => $preference['enabled']]);
        }

        return $this->index($request);
    }
}
