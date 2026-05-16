<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Verify email - {{ config('app.name') }}</title>
    </head>
    <body>
        <main>
            <h1>Verify your email address</h1>
            <p>Check your inbox for the verification link before continuing.</p>

            @if (session('status') === 'verification-link-sent')
                <p>A new verification link has been sent.</p>
            @endif

            <form method="POST" action="{{ route('verification.send') }}">
                @csrf
                <button type="submit">Resend verification email</button>
            </form>
        </main>
    </body>
</html>
