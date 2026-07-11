import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { parseBigId } from '../common/controller-utils';
import { CurrentUser } from '../types';
import { TRAVEL_SUGGESTION_CATEGORIES, validSuggestionCategory } from './travel.constants';

@Injectable()
export class TravelService {
  constructor(private readonly prisma: PrismaService) {}

  listTrips(user: CurrentUser) {
    if (user.role === 'CLIENT') {
      return this.prisma.travelTrip.findMany({
        where: {
          active: true,
          members: {
            some: {
              active: true,
              OR: [{ email: { equals: user.email, mode: 'insensitive' } }, { player: { email: { equals: user.email, mode: 'insensitive' } } }],
            },
          },
        },
        include: { destination: true, members: { where: { active: true } }, expenses: true },
        orderBy: { id: 'desc' },
      });
    }
    return this.prisma.travelTrip.findMany({
      where: { active: true, OR: [{ ownerAdminId: BigInt(user.id) }, { permissions: { some: { adminId: BigInt(user.id) } } }] },
      include: { destination: true, members: { where: { active: true } }, expenses: true },
      orderBy: { id: 'desc' },
    });
  }

  async canManage(user: CurrentUser, tripId: bigint) {
    if (user.role !== 'ADMIN') return false;
    return !!(await this.prisma.travelTrip.findFirst({
      where: {
        id: tripId,
        active: true,
        OR: [{ ownerAdminId: BigInt(user.id) }, { permissions: { some: { adminId: BigInt(user.id) } } }],
      },
      select: { id: true },
    }));
  }

  async canView(user: CurrentUser, tripId: bigint) {
    if (user.role === 'ADMIN') return this.canManage(user, tripId);
    return !!(await this.prisma.travelTrip.findFirst({
      where: {
        id: tripId,
        active: true,
        members: {
          some: {
            active: true,
            OR: [{ email: { equals: user.email, mode: 'insensitive' } }, { player: { email: { equals: user.email, mode: 'insensitive' } } }],
          },
        },
      },
      select: { id: true },
    }));
  }

  async detail(tripId: bigint, forAdmin = true) {
    const trip = await this.prisma.travelTrip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        destination: true,
        ownerAdmin: true,
        permissions: { include: { admin: true }, orderBy: { id: 'asc' } },
      },
    });
    const [members, expenses, destinationSuggestions] = await Promise.all([
      this.prisma.travelTripMember.findMany({
        where: { tripId, active: true },
        include: { collections: true, player: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.travelTripExpense.findMany({
        where: { tripId },
        include: { splits: true, paidByMember: true },
        orderBy: [{ spentDate: 'asc' }, { id: 'asc' }],
      }),
      trip.destinationId ? this.suggestionsForDestination(trip.destinationId) : Promise.resolve([]),
    ]);
    // Dữ liệu chỉ dành cho admin quản trị chuyến; không truy vấn khi người xem là CLIENT.
    const [availablePeople, admins, destinations] = forAdmin
      ? await Promise.all([this.availablePeople(tripId), this.availableAdmins(tripId, trip.ownerAdminId), this.destinations()])
      : [[], [], []];
    return { trip, members, expenses, availablePeople, admins, destinations, destinationSuggestions };
  }

  destinations() {
    return this.prisma.travelDestination.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  async createTrip(user: CurrentUser, body: Record<string, string>) {
    const destinationId = await this.destinationIdFromBody(body);
    return this.prisma.travelTrip.create({
      data: {
        name: cleanRequired(body.name, 'Tên chuyến đi'),
        description: clean(body.description),
        ownerAdminId: BigInt(user.id),
        destinationId,
      },
    });
  }

  async updateTrip(tripId: bigint, body: Record<string, string>) {
    const destinationId = await this.destinationIdFromBody(body);
    return this.prisma.travelTrip.update({
      where: { id: tripId },
      data: { name: cleanRequired(body.name, 'Tên chuyến đi'), description: clean(body.description), destinationId },
    });
  }

  deleteTrip(tripId: bigint) {
    return this.prisma.travelTrip.update({ where: { id: tripId }, data: { active: false, treasurerMemberId: null } });
  }

  async people() {
    return this.prisma.travelPerson.findMany({ where: { active: true }, include: { player: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  async createPerson(user: CurrentUser, body: Record<string, string>) {
    const email = clean(body.email).toLowerCase();
    const player = email ? await this.findOrCreatePlayer(cleanRequired(body.name, 'Tên thành viên'), email) : null;
    return this.prisma.travelPerson.create({
      data: { name: cleanRequired(body.name, 'Tên thành viên'), email, playerId: player?.id, ownerAdminId: user.role === 'ADMIN' ? BigInt(user.id) : null },
    });
  }

  async updatePerson(personId: bigint, body: Record<string, string>) {
    const email = clean(body.email).toLowerCase();
    const name = cleanRequired(body.name, 'Tên thành viên');
    const player = email ? await this.findOrCreatePlayer(name, email) : null;
    return this.prisma.travelPerson.update({
      where: { id: personId },
      data: { name, email, playerId: player?.id || null, members: { updateMany: { where: { active: true }, data: { name, email, playerId: player?.id || null } } } },
    });
  }

  deletePerson(personId: bigint) {
    return this.prisma.travelPerson.update({ where: { id: personId }, data: { active: false } });
  }

  async availablePeople(tripId: bigint) {
    return this.prisma.travelPerson.findMany({
      where: { active: true, members: { none: { tripId, active: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  availableAdmins(tripId: bigint, ownerAdminId?: bigint | null) {
    return this.prisma.appUser.findMany({
      where: {
        role: 'ADMIN',
        id: { notIn: [ownerAdminId || 0n] },
        travelPermissions: { none: { tripId } },
      },
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
    });
  }

  addPermission(tripId: bigint, adminId: bigint) {
    return this.prisma.travelTripPermission.create({ data: { tripId, adminId } });
  }

  removePermission(tripId: bigint, permissionId: bigint) {
    return this.prisma.travelTripPermission.deleteMany({ where: { id: permissionId, tripId } });
  }

  suggestions(destinationId?: bigint, category?: string) {
    return this.prisma.travelSuggestion.findMany({
      where: {
        active: true,
        destination: { active: true },
        ...(destinationId ? { destinationId } : {}),
        ...(category && validSuggestionCategory(category) ? { category } : {}),
      },
      include: { destination: true },
      orderBy: [{ destination: { name: 'asc' } }, { category: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  suggestionsForDestination(destinationId: bigint) {
    return this.suggestions(destinationId);
  }

  async createDestination(name: string) {
    return this.prisma.travelDestination.upsert({
      where: { name: cleanRequired(name, 'Địa danh') },
      update: { active: true },
      create: { name: cleanRequired(name, 'Địa danh') },
    });
  }

  async saveSuggestion(body: Record<string, string>, suggestionId?: bigint) {
    const category = clean(body.category);
    if (!validSuggestionCategory(category)) throw new BadRequestException('Loại gợi ý không hợp lệ');
    const destinationId = parseBigId(body.destinationId || body.destination_id);
    if (!destinationId) throw new BadRequestException('Cần chọn địa danh hợp lệ');
    const data = {
      destinationId,
      category,
      name: cleanRequired(body.name, 'Tên gợi ý'),
      address: clean(body.address),
      phone: clean(body.phone),
      openingHours: clean(body.openingHours),
      description: clean(body.description),
      mapUrl: clean(body.mapUrl),
      sourceUrl: clean(body.sourceUrl),
    };
    if (suggestionId) return this.prisma.travelSuggestion.update({ where: { id: suggestionId }, data });
    return this.prisma.travelSuggestion.create({ data });
  }

  deleteSuggestion(suggestionId: bigint) {
    return this.prisma.travelSuggestion.update({ where: { id: suggestionId }, data: { active: false } });
  }

  private async destinationIdFromBody(body: Record<string, string>) {
    const destinationName = clean(body.destinationName);
    if (destinationName) return (await this.createDestination(destinationName)).id;
    return parseBigId(body.destinationId);
  }

  private async findOrCreatePlayer(displayName: string, email: string) {
    return this.prisma.player.upsert({
      where: { email },
      update: { displayName },
      create: { displayName, email, skillLevel: 'C', notes: '' },
    });
  }
}

export function clean(value: unknown) {
  return String(value || '').trim();
}

export function cleanRequired(value: unknown, label: string) {
  const result = clean(value);
  if (!result) throw new BadRequestException(`${label} là bắt buộc`);
  return result;
}

export const travelSuggestionCategories = TRAVEL_SUGGESTION_CATEGORIES;
