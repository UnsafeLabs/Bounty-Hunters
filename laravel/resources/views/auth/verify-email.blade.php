<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email Address</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <main style="max-width:480px;margin:64px auto;padding:32px;background-color:#ffffff;border-radius:8px;">
        <h1 style="margin:0 0 16px;font-size:22px;">Verify your email address</h1>

        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            Thanks for signing up! Before getting started, please verify your email address by
            clicking the link we just emailed to you. If you didn't receive the email, we'll gladly send you another.
        </p>

        @if (session('status') === 'verification-link-sent')
            <p style="margin:0 0 16px;font-size:14px;color:#15803d;">
                A new verification link has been sent to the email address you provided during registration.
            </p>
        @endif

        <form method="POST" action="{{ route('verification.send') }}">
            @csrf
            <button type="submit" style="display:inline-block;padding:12px 24px;color:#ffffff;background-color:#2563eb;font-size:15px;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">
                Resend verification email
            </button>
        </form>
    </main>
</body>
</html>
