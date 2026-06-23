<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email Address</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
        <tr>
            <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
                    <tr>
                        <td style="background-color:#2563eb;padding:24px 32px;">
                            <span style="color:#ffffff;font-size:20px;font-weight:bold;">{{ config('app.name') }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px;">
                            <h1 style="margin:0 0 16px;font-size:22px;">Verify your email address</h1>
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
                                @if (! empty($name))Hi {{ $name }},@else Hello,@endif
                            </p>
                            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
                                Please confirm that this is your email address by clicking the button below. This secure link will expire in {{ $expireMinutes }} minutes.
                            </p>
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="border-radius:6px;background-color:#2563eb;">
                                        <a href="{{ $url }}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:6px;">Verify Email Address</a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:24px 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
                                If you did not create an account, no further action is required.
                            </p>
                            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;word-break:break-all;">
                                If the button does not work, copy and paste this URL into your browser:<br>
                                <a href="{{ $url }}" style="color:#2563eb;">{{ $url }}</a>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px;background-color:#f9fafb;font-size:12px;color:#9ca3af;">
                            &copy; {{ date('Y') }} {{ config('app.name') }}. All rights reserved.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
