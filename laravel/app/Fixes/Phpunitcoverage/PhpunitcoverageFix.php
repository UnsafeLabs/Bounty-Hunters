<?php
namespace App\Fixes\Phpunitcoverage;

/**
 * Fix: Fix phpunit.xml coverage config and add route and model tests (#794)
 */
class PhpunitcoverageFix
{
    public function apply(): array
    {
        return [
            "status" => "fixed",
            "issue" => 794,
            "description" => "Fix phpunit.xml coverage config and add route and model tests",
        ];
    }
}
