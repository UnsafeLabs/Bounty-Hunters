<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify email</title>
</head>
<body>
    <main>
        <h1>Verify your email address</h1>

        @if (session('status') === 'verification-link-sent')
            <p>A fresh verification link has been sent to your email address.</p>
        @endif

        <p>Please verify your email before continuing.</p>

        <form method="POST" action="{{ route('verification.send') }}">
            @csrf
            <button type="submit">Send verification link</button>
        </form>
    </main>
</body>
</html>
