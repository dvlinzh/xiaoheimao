Get-WinEvent -FilterHashtable @{LogName='Application'} -MaxEvents 400 -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'PetCat' } |
  Select-Object -First 4 TimeCreated, Message |
  Format-List
