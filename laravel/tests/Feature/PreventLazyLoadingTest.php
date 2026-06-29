<?php

namespace Tests\Feature;

use Illuminate\Database\Eloquent\Model;
use Tests\TestCase;

class PreventLazyLoadingTest extends TestCase
{
    public function test_lazy_loading_is_prevented_in_the_testing_environment(): void
    {
        $this->assertSame('testing', $this->app->environment());
        $this->assertFalse($this->app->isProduction());
        $this->assertTrue(Model::preventsLazyLoading());
    }
}
