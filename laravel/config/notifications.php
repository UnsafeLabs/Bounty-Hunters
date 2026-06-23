<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Notification Event Types
    |--------------------------------------------------------------------------
    |
    | The notification categories a user may tune. Each preference row, every
    | validated request, and the channel router are constrained to this list,
    | so an unknown event type is rejected rather than silently stored.
    |
    */

    'event_types' => [
        'account',
        'security',
        'marketing',
        'product_updates',
    ],

    /*
    |--------------------------------------------------------------------------
    | Delivery Channels
    |--------------------------------------------------------------------------
    |
    | The transports a notification may be routed through. A preference always
    | pairs one event type with one channel from this list.
    |
    */

    'channels' => [
        'mail',
        'slack',
        'database',
    ],

    /*
    |--------------------------------------------------------------------------
    | Default Channels
    |--------------------------------------------------------------------------
    |
    | Channels enabled when a user is first seeded with preferences (see the
    | UserObserver). A user can still disable a default channel or enable a
    | non-default one afterwards. The router also falls back to these for any
    | channel a user has no stored row for.
    |
    */

    'defaults' => [
        'mail',
        'database',
    ],

];
