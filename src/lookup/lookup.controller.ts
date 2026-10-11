import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators.js';
import { badRequest } from '../common/http.js';

@ApiTags('public')
@Controller('public/pincode')
export class LookupController {
  @Public()
  @Get(':code')
  async pin(@Param('code') code: string) {
    if (!/^\d{6}$/.test(code)) throw badRequest('PIN_INVALID', 'Enter a 6-digit PIN code.');
    const response = await fetch(`https://api.postalpincode.in/pincode/${code}`);
    const body = (await response.json()) as Array<{
      Status: string;
      PostOffice?: Array<{ District: string; State: string; Name: string }>;
    }>;
    const office = body[0]?.PostOffice?.[0];
    if (!office) throw badRequest('PIN_UNKNOWN', 'We could not find that PIN code.');
    return { city: office.District, state: office.State, office: office.Name };
  }
}
