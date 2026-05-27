
namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;
use Illuminate\Http\UploadedFile;

class File extends Model
{
    use HasFactory;

    protected $table = 'files';

    protected $fillable = [
        'original_name',
        'stored_path',
        'mime_type',
        "size_bytes",
        "checksum_sha256",
        "uploaded_by",
        "thumbnail_path"
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function getFilePath()
    {
        return storage_path('app/uploads/' . date('Y/m/d') . '/');
    }

    public function storeFile(UploadedFile $file)
    {
        $path = $this->getFilePath();
        $fileName = $file->hashName();
        $file->storeAs($path, $fileName);
        return $path . $fileName;
    }

    public function generateThumbnail($filePath)
    {
        // Thumbnail generation logic will go here
    }
}