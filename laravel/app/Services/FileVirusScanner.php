<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;

class FileVirusScanner
{
    private const EICAR_SIGNATURE = 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

    public function isClean(UploadedFile $file): bool
    {
        $path = $file->getRealPath();

        if ($path === false) {
            return false;
        }

        $contents = file_get_contents($path, false, null, 0, 1024 * 1024);

        if ($contents === false) {
            return false;
        }

        return ! str_contains($contents, self::EICAR_SIGNATURE);
    }
}
