<?php

namespace App\Http\Controllers;

use App\Http\Requests\BulkUpdateNotificationPreferencesRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
    public function bulkUpdate(BulkUpdateNotificationPreferencesRequest $request): JsonResponse
    {
        foreach ($request->validated()['preferences'] as $preference) {
            $request->user()->notificationPreferences()
                ->whereKey($preference['id'])
                ->update(['enabled' => $preference['enabled']]);
        }

        return $this->index($request);
    }
}
