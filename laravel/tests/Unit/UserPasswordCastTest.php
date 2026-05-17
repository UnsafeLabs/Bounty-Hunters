<?php

test('user password respects bcrypt rounds from config', function () {
    $originalRounds = config('hashing.bcrypt.rounds');
    config(['hashing.bcrypt.rounds' => 12]);

    $user = new \App\Models\User();
    $user->password = 'secret';
    $hash = $user->getAttributes()['password'];

    // Verify the hash uses the configured rounds
    expect(Hash::info($hash)['rounds'])->toBe(12);

    // Restore original config
    config(['hashing.bcrypt.rounds' => $originalRounds]);
});

test('password verification works with old and new rounds', function () {
    // Simulate hash with old rounds (10)
    $oldHash = Hash::make('password', ['rounds' => 10]);
    expect(Hash::check('password', $oldHash))->toBeTrue();

    // Simulate hash with new rounds (12)
    $newHash = Hash::make('password', ['rounds' => 12]);
    expect(Hash::check('password', $newHash))->toBeTrue();
});
