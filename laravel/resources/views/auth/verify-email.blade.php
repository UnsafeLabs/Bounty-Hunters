<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Verify email</title>
    </head>
    <body>
        <main>
            <h1>Verify your email address</h1>

            @if (session('status') === 'verification-link-sent')
                <p>A new verification link has been sent to your email address.</p>
            @else
                <p>Please check your inbox and follow the verification link before continuing.</p>
            @endif

            <form method="POST" action="{{ route('verification.send') }}">
                @csrf
                <button type="submit">Resend verification email</button>
            </form>
        </main>
    </body>
</html>
