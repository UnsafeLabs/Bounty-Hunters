<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $preferences = $request->user()->notificationPreferences()
            ->orderBy('event_type')
            ->orderBy('channel')
            ->paginate(50);

        return response()->json([
            'data' => $preferences->items(),
            'links' => [
                'first' => $preferences->url(1),
                'last' => $preferences->url($preferences->lastPage()),
                'prev' => $preferences->previousPageUrl(),
                'next' => $preferences->nextPageUrl(),
            ],
            'meta' => [
                'current_page' => $preferences->currentPage(),
                'from' => $preferences->firstItem(),
                'last_page' => $preferences->lastPage(),
                'path' => $preferences->path(),
                'per_page' => $preferences->perPage(),
                'to' => $preferences->lastItem(),
                'total' => $preferences->total(),
            ],
        ]);
    }

    public function update(Request $request, NotificationPreference $notificationPreference): JsonResponse
    {
        abort_unless($notificationPreference->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        $notificationPreference->update($validated);

        return response()->json($notificationPreference->refresh());
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => 'required|array|min:1|max:100',
            'preferences.*.id' => [
                'required',
                'integer',
                'distinct',
                'exists:notification_preferences,id,user_id,'.$request->user()->id,
            ],
            'preferences.*.enabled' => 'required|boolean',
        ]);

        $preferenceIds = collect($validated['preferences'])->pluck('id')->all();

        $updatedPreferences = DB::transaction(function () use ($request, $preferenceIds, $validated): Collection {
            $lockedPreferences = $request->user()->notificationPreferences()
                ->whereIn('id', $preferenceIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            if ($lockedPreferences->count() !== count($preferenceIds)) {
                abort(409, 'Some preferences were modified concurrently. Please retry.');
            }

            foreach ($validated['preferences'] as $data) {
                $lockedPreferences->get($data['id'])->update(['enabled' => $data['enabled']]);
            }

            return $request->user()->notificationPreferences()
                ->whereIn('id', $preferenceIds)
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get();
        });

        return response()->json($updatedPreferences);
    }
}
