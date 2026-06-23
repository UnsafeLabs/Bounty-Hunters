<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BulkUpdateNotificationPreferencesRequest extends FormRequest
{
    /**
     * Validation rules for a bulk preference toggle.
     *
     * Every id must belong to the authenticated user, so a foreign or unknown
     * id is rejected before any write. Each item is required to be an array
     * with a non-null integer id and boolean flag, so a malformed or null
     * entry cannot slip past the type checks.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $ownedIds = $this->user()->notificationPreferences()->pluck('id')->all();

        return [
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*' => ['required', 'array'],
            'preferences.*.id' => ['required', 'integer', 'distinct', Rule::in($ownedIds)],
            'preferences.*.enabled' => ['required', 'boolean'],
        ];
    }
}
