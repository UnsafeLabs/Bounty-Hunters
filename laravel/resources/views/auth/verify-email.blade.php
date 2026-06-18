<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify Email</title>
</head>
<body>
    <main>
        <h1>Verify your email</h1>

        @if (session('status') === 'verification-link-sent')
            <p>A new verification link has been sent.</p>
        @elseif (request('verified'))
            <p>Your email address has been verified.</p>
        @else
            <p>Check your inbox for a verification link.</p>
        @endif

        <form method="POST" action="{{ route('verification.send') }}">
            @csrf
            <button type="submit">Send verification link</button>
        </form>
    </main>
</body>
</html>
