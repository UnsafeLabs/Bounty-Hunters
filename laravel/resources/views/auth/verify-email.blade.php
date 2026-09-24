<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify your email address</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:560px;margin:64px auto;background:#ffffff;border-radius:8px;padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;">Verify your email address</h1>

        @if (session('status') === 'verification-link-sent')
            <p style="margin:0 0 16px;color:#047857;">
                A new verification link has been sent to your email address.
            </p>
        @else
            <p style="margin:0 0 16px;line-height:1.5;">
                Before continuing, please check your inbox for a verification link we emailed you.
                If you did not receive it, you can request another below.
            </p>
        @endif

        <form method="POST" action="{{ route('verification.send') }}">
            @csrf
            <button type="submit"
                    style="background:#2563eb;color:#ffffff;border:0;padding:12px 24px;border-radius:6px;font-weight:bold;cursor:pointer;">
                Resend verification email
            </button>
        </form>
    </div>
</body>
</html>
