<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Email</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 580px; margin: 40px auto; padding: 20px; }
        .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px; background: #fff; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; }
        .btn:hover { background: #2563eb; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Verify Your Email Address</h1>
        <p>Thanks for signing up! Before getting started, could you verify your email address by clicking the button below?</p>
        <p style="text-align: center; margin: 32px 0;">
            <a href="{{ $verificationUrl }}" class="btn">Verify Email Address</a>
        </p>
        <p>If you did not create an account, no further action is required.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
        <p style="font-size: 12px; color: #94a3b8;">If you are having trouble clicking the button, copy and paste the URL below into your web browser:</p>
        <p style="font-size: 12px; color: #64748b; word-break: break-all;">{{ $verificationUrl }}</p>
    </div>
</body>
</html>
