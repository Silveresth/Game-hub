# Voix off de la vidéo promo : une phrase par réplique de voice.json, avec une voix française de Windows (OneCore).
# Chaque réplique est accélérée si besoin pour tenir dans son créneau (champ « max », en secondes de parole).
# Usage : powershell -File voice.ps1 -Voice Paul   (ou Julie, Hortense)
param([string]$Voice = 'Paul', [double]$BaseRate = 1.12, [string]$Pitch = '+4%')
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lines = Get-Content (Join-Path $dir 'voice.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$out = Join-Path $dir ("voice-" + $Voice.ToLower())
New-Item -ItemType Directory -Force $out | Out-Null

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait() | Out-Null
  $t.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -match $Voice } | Select-Object -First 1
if (-not $v) { throw "Voix introuvable : $Voice" }
$synth.Voice = $v

function Synth([string]$text, [double]$rate) {
  $esc = [Security.SecurityElement]::Escape($text)
  $r = $rate.ToString([Globalization.CultureInfo]::InvariantCulture)
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='fr-FR'><prosody rate='$r' pitch='$Pitch'>$esc</prosody></speak>"
  $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $size = [uint32]$stream.Size
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $null = Await ($reader.LoadAsync($size)) ([uint32])
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  $reader.Dispose()
  $stream.Dispose()
  return , $bytes
}

# Durée réellement parlée (sans les silences de début et de fin), WAV PCM 16 bits
function SpokenSeconds([byte[]]$b) {
  $rate = [BitConverter]::ToInt32($b, 24)
  $ch = [BitConverter]::ToInt16($b, 22)
  $i = 12
  while ($i -lt $b.Length - 8) {
    $id = [Text.Encoding]::ASCII.GetString($b, $i, 4)
    $sz = [BitConverter]::ToInt32($b, $i + 4)
    if ($id -eq 'data') { $start = $i + 8; $len = $sz; break }
    $i += 8 + $sz
  }
  $n = [int]($len / (2 * $ch))
  $first = -1; $last = -1
  for ($k = 0; $k -lt $n; $k += 4) {
    $s = [Math]::Abs([int][BitConverter]::ToInt16($b, $start + $k * 2 * $ch))
    if ($s -gt 900) { if ($first -lt 0) { $first = $k }; $last = $k }
  }
  return ($last - $first) / $rate
}

"Voix : $($v.DisplayName)"
foreach ($l in $lines) {
  $rate = $BaseRate
  for ($try = 0; $try -lt 6; $try++) {
    $b = Synth $l.text $rate
    $d = SpokenSeconds $b
    if ($d -le $l.max -or $rate -ge 1.75) { break }
    $rate = [Math]::Min(1.75, $rate * [Math]::Max(1.05, $d / $l.max))
  }
  [IO.File]::WriteAllBytes((Join-Path $out "$($l.id).wav"), $b)
  $flag = if ($d -gt $l.max + 0.05) { '  <- trop long' } else { '' }
  "{0}  {1,5:N2} s / {2,4:N2} s  vitesse {3:N2}  {4}{5}" -f $l.id, $d, $l.max, $rate, $l.text, $flag
}
