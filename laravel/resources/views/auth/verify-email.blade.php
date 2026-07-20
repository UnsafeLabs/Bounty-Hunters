<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify Email</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #0b1220; color: #e8eefc; margin: 0; padding: 2rem; }
        .card { max-width: 480px; margin: 2rem auto; background: #141c2f; border-radius: 12px; padding: 1.5rem 1.75rem; }
        a.button { display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 0.65rem 1.1rem; border-radius: 8px; }
        .muted { color: #9aa8c7; font-size: 0.95rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Verify your email</h1>
        <p class="muted">Thanks for signing up@if(isset($user) && isset($user->name)), {{ $user->name }}@endif. Please confirm your email address to continue.</p>
        @isset($url)
            <p><a class="button" href="{{ $url }}">Verify Email Address</a></p>
            <p class="muted">If the button does not work, copy this link:<br>{{ $url }}</p>
        @else
            <p class="muted">Check your inbox for a verification link. You can request another below if needed.</p>
            <form method="POST" action="{{ url('/email/verification-notification') }}">
                @csrf
                <button class="button" type="submit">Resend verification email</button>
            </form>
        @endisset
    </div>
</body>
</html>
